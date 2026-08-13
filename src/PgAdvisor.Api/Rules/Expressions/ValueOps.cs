using System.Globalization;

namespace PgAdvisor.Api.Rules.Expressions;

/// <summary>
/// Coercions entre les types renvoyés par Npgsql et le langage d'expressions des règles.
/// Règle de conception : une valeur NULL ne fait jamais échouer une expression, elle rend
/// simplement la condition fausse — une statistique manquante ne doit pas casser une règle.
/// </summary>
public static class ValueOps
{
    public static bool IsNumeric(object? value) => value switch
    {
        sbyte or byte or short or ushort or int or uint or long or ulong or float or double or decimal => true,
        _ => false,
    };

    public static bool TryToNumber(object? value, out double number)
    {
        switch (value)
        {
            case null:
                number = 0;
                return false;
            case bool b:
                number = b ? 1 : 0;
                return true;
            case double d:
                number = d;
                return true;
            case float f:
                number = f;
                return true;
            case decimal m:
                number = (double)m;
                return true;
            case sbyte or byte or short or ushort or int or uint or long or ulong:
                number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                return true;
            case TimeSpan span:
                number = span.TotalSeconds;
                return true;
            case string s when double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed):
                number = parsed;
                return true;
            default:
                number = 0;
                return false;
        }
    }

    /// <summary>Valeur de vérité : null est faux, un nombre est vrai s'il est non nul.</summary>
    public static bool ToBool(object? value) => value switch
    {
        null => false,
        bool b => b,
        string s => !string.IsNullOrEmpty(s) && !string.Equals(s, "false", StringComparison.OrdinalIgnoreCase),
        _ => TryToNumber(value, out var number) ? number != 0 : true,
    };

    public static string ToInvariantString(object? value) => value switch
    {
        null => string.Empty,
        bool b => b ? "true" : "false",
        double d => d.ToString("0.######", CultureInfo.InvariantCulture),
        float f => f.ToString("0.######", CultureInfo.InvariantCulture),
        decimal m => m.ToString("0.######", CultureInfo.InvariantCulture),
        DateTime dt => dt.ToString("u", CultureInfo.InvariantCulture),
        DateTimeOffset dto => dto.ToString("u", CultureInfo.InvariantCulture),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };

    /// <summary>
    /// Comparaison relationnelle. Retourne null lorsque les opérandes ne sont pas comparables
    /// (dont tout cas impliquant NULL) : l'appelant traduit cela par « condition non satisfaite ».
    /// </summary>
    public static int? Compare(object? left, object? right)
    {
        if (left is null || right is null)
        {
            return null;
        }

        if (TryToNumber(left, out var leftNumber) && TryToNumber(right, out var rightNumber))
        {
            return leftNumber.CompareTo(rightNumber);
        }

        if (left is DateTime or DateTimeOffset && right is DateTime or DateTimeOffset)
        {
            var l = left is DateTimeOffset ldto ? ldto : new DateTimeOffset((DateTime)left, TimeSpan.Zero);
            var r = right is DateTimeOffset rdto ? rdto : new DateTimeOffset((DateTime)right, TimeSpan.Zero);
            return l.CompareTo(r);
        }

        if (left is string || right is string)
        {
            return string.CompareOrdinal(ToInvariantString(left), ToInvariantString(right));
        }

        return null;
    }

    public static bool AreEqual(object? left, object? right)
    {
        if (left is null || right is null)
        {
            return left is null && right is null;
        }

        if (left is bool || right is bool)
        {
            return ToBool(left) == ToBool(right);
        }

        var comparison = Compare(left, right);
        return comparison == 0;
    }

    /// <summary>Applique un cast de style PostgreSQL (<c>valeur::float</c>).</summary>
    public static object? Cast(object? value, string type)
    {
        if (value is null)
        {
            return null;
        }

        switch (type.ToLowerInvariant())
        {
            case "int":
            case "int4":
            case "int8":
            case "integer":
            case "bigint":
            case "smallint":
                return TryToNumber(value, out var integral) ? (long)Math.Truncate(integral) : null;

            case "float":
            case "float4":
            case "float8":
            case "double":
            case "numeric":
            case "decimal":
            case "real":
                return TryToNumber(value, out var real) ? real : null;

            case "text":
            case "varchar":
            case "string":
                return ToInvariantString(value);

            case "bool":
            case "boolean":
                return ToBool(value);

            default:
                throw new ExpressionException($"Cast inconnu : ::{type}");
        }
    }
}

public sealed class ExpressionException(string message) : Exception(message);
