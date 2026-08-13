using System.Security.Cryptography;

namespace PgAdvisor.Api.Security;

/// <summary>
/// Hash de mot de passe PBKDF2-HMAC-SHA256. Format stocké :
/// <c>pbkdf2-sha256$iterations$saltBase64$hashBase64</c>.
/// </summary>
public static class PasswordHasher
{
    private const string Prefix = "pbkdf2-sha256";
    private const int Iterations = 210_000;
    private const int SaltSize = 16;
    private const int HashSize = 32;

    public static string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);

        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashSize);
        return $"{Prefix}${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    /// <param name="needsRehash">
    /// Vrai si le hash est valide mais produit avec un coût inférieur au coût courant :
    /// l'appelant peut le régénérer à la volée après une authentification réussie.
    /// </param>
    public static bool Verify(string password, string stored, out bool needsRehash)
    {
        needsRehash = false;

        if (string.IsNullOrEmpty(password) || string.IsNullOrEmpty(stored))
        {
            return false;
        }

        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != Prefix || !int.TryParse(parts[1], out var iterations))
        {
            return false;
        }

        byte[] salt, expected;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException)
        {
            return false;
        }

        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        if (!CryptographicOperations.FixedTimeEquals(actual, expected))
        {
            return false;
        }

        needsRehash = iterations < Iterations || expected.Length < HashSize;
        return true;
    }

    /// <summary>Mot de passe aléatoire lisible, utilisé pour le bootstrap du compte admin.</summary>
    public static string GenerateReadablePassword(int length = 20)
    {
        // Alphabet sans caractères ambigus (0/O, 1/l/I) pour une saisie manuelle fiable.
        const string alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        return RandomNumberGenerator.GetString(alphabet, length);
    }
}
