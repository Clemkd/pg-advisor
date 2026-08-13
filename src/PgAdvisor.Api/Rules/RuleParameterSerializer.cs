using System.Globalization;
using System.Text.Json;

namespace PgAdvisor.Api.Rules;

/// <summary>
/// Sérialisation des seuils d'une règle. Les valeurs restent scalaires : un seuil est un
/// nombre, un booléen ou du texte, jamais une structure — la surcharge depuis l'IHM reste
/// ainsi éditable dans un simple formulaire.
/// </summary>
public static class RuleParameterSerializer
{
    public static Dictionary<string, object?> Deserialize(string? json)
    {
        var result = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(json))
        {
            return result;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return result;
            }

            foreach (var property in document.RootElement.EnumerateObject())
            {
                result[property.Name] = property.Value.ValueKind switch
                {
                    JsonValueKind.Number => property.Value.TryGetInt64(out var integral) ? integral : property.Value.GetDouble(),
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    JsonValueKind.String => property.Value.GetString(),
                    JsonValueKind.Null => null,
                    _ => property.Value.ToString(),
                };
            }
        }
        catch (JsonException)
        {
            // Surcharge illisible : on retombe sur les seuils du fichier YAML.
        }

        return result;
    }

    public static string Serialize(IReadOnlyDictionary<string, object?> values) =>
        JsonSerializer.Serialize(values);

    /// <summary>
    /// YamlDotNet rend les scalaires sous forme de chaînes ; on les ramène à leur type naturel
    /// pour qu'ils puissent servir de paramètre SQL typé.
    /// </summary>
    public static object? NormalizeScalar(object? value)
    {
        if (value is not string text)
        {
            return value;
        }

        if (bool.TryParse(text, out var boolean))
        {
            return boolean;
        }

        if (long.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var integral))
        {
            return integral;
        }

        if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var real))
        {
            return real;
        }

        return text;
    }
}
