using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace PgAdvisor.Api.Security;

/// <summary>
/// Chiffre les secrets de connexion au repos (AES-GCM). La clé vit dans le volume de données,
/// hors de la base : un dump SQLite seul ne suffit pas à récupérer les mots de passe.
/// </summary>
public sealed class SecretProtector
{
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private const int KeySize = 32;

    private readonly byte[] _key;

    public SecretProtector(IOptions<AdvisorOptions> options, ILogger<SecretProtector> logger)
    {
        _key = LoadOrCreateKey(options.Value.KeyPath, logger);
    }

    public string Protect(string plaintext)
    {
        if (string.IsNullOrEmpty(plaintext))
        {
            return string.Empty;
        }

        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var plainBytes = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[plainBytes.Length];
        var tag = new byte[TagSize];

        using var aes = new AesGcm(_key, TagSize);
        aes.Encrypt(nonce, plainBytes, cipher, tag);

        var payload = new byte[NonceSize + TagSize + cipher.Length];
        nonce.CopyTo(payload, 0);
        tag.CopyTo(payload, NonceSize);
        cipher.CopyTo(payload, NonceSize + TagSize);
        return Convert.ToBase64String(payload);
    }

    public string Unprotect(string payload)
    {
        if (string.IsNullOrEmpty(payload))
        {
            return string.Empty;
        }

        var bytes = Convert.FromBase64String(payload);
        if (bytes.Length < NonceSize + TagSize)
        {
            throw new CryptographicException("Payload chiffré tronqué.");
        }

        var nonce = bytes.AsSpan(0, NonceSize);
        var tag = bytes.AsSpan(NonceSize, TagSize);
        var cipher = bytes.AsSpan(NonceSize + TagSize);
        var plain = new byte[cipher.Length];

        using var aes = new AesGcm(_key, TagSize);
        aes.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }

    private static byte[] LoadOrCreateKey(string path, ILogger logger)
    {
        var directory = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        if (File.Exists(path))
        {
            var existing = File.ReadAllBytes(path);
            if (existing.Length == KeySize)
            {
                return existing;
            }

            throw new InvalidOperationException(
                $"La clé de chiffrement {path} est invalide ({existing.Length} octets au lieu de {KeySize}). " +
                "La supprimer invalide les mots de passe enregistrés : ils devront être ressaisis.");
        }

        var key = RandomNumberGenerator.GetBytes(KeySize);
        File.WriteAllBytes(path, key);
        RestrictPermissions(path);
        logger.LogInformation("Clé de chiffrement des secrets créée dans {Path}", path);
        return key;
    }

    private static void RestrictPermissions(string path)
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        try
        {
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        catch (Exception)
        {
            // Système de fichiers ne supportant pas les permissions Unix : la clé reste utilisable.
        }
    }
}
