using System.Globalization;
using System.Text;

namespace PgAdvisor.Api.Rules.Expressions;

/// <summary>
/// Gabarit de message d'une règle : texte libre et interpolations <c>{{ expression | filtre }}</c>.
/// Les filtres évitent aux auteurs de règles de formater les octets ou les durées en SQL.
/// </summary>
public sealed class Template
{
    private readonly List<Segment> _segments;

    private Template(List<Segment> segments) => _segments = segments;

    public static Template Parse(string source)
    {
        var segments = new List<Segment>();
        var literal = new StringBuilder();
        var index = 0;

        while (index < source.Length)
        {
            if (source[index] == '{' && index + 1 < source.Length && source[index + 1] == '{')
            {
                var close = source.IndexOf("}}", index + 2, StringComparison.Ordinal);
                if (close < 0)
                {
                    throw new ExpressionException($"Interpolation non fermée à la position {index} : « }}}} » manquant.");
                }

                if (literal.Length > 0)
                {
                    segments.Add(Segment.Literal(literal.ToString()));
                    literal.Clear();
                }

                segments.Add(ParseInterpolation(source[(index + 2)..close]));
                index = close + 2;
                continue;
            }

            literal.Append(source[index]);
            index++;
        }

        if (literal.Length > 0)
        {
            segments.Add(Segment.Literal(literal.ToString()));
        }

        return new Template(segments);
    }

    public static bool TryParse(string source, out Template? template, out string? error)
    {
        try
        {
            template = Parse(source);
            error = null;
            return true;
        }
        catch (Exception ex) when (ex is ExpressionException or ArgumentException)
        {
            template = null;
            error = ex.Message;
            return false;
        }
    }

    public string Render(IReadOnlyDictionary<string, object?> variables)
    {
        var builder = new StringBuilder();

        foreach (var segment in _segments)
        {
            if (segment.Text is not null)
            {
                builder.Append(segment.Text);
                continue;
            }

            var value = segment.Expression!.Evaluate(variables);
            foreach (var filter in segment.Filters)
            {
                value = ApplyFilter(value, filter);
            }

            builder.Append(ValueOps.ToInvariantString(value));
        }

        return builder.ToString();
    }

    public IEnumerable<string> References() =>
        _segments.Where(s => s.Expression is not null).SelectMany(s => s.Expression!.References());

    private static Segment ParseInterpolation(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            throw new ExpressionException("Interpolation vide : {{ }}.");
        }

        var parts = SplitFilters(body);
        var expression = ExpressionParser.Parse(parts[0]);
        var filters = new List<FilterSpec>();

        foreach (var raw in parts.Skip(1))
        {
            var text = raw.Trim();
            if (text.Length == 0)
            {
                continue;
            }

            var separator = text.IndexOf(':');
            var name = (separator < 0 ? text : text[..separator]).Trim().ToLowerInvariant();
            var argument = separator < 0 ? null : text[(separator + 1)..].Trim();

            if (!KnownFilters.Contains(name))
            {
                throw new ExpressionException(
                    $"Filtre inconnu « {name} ». Disponibles : {string.Join(", ", KnownFilters.Order())}.");
            }

            filters.Add(new FilterSpec(name, argument));
        }

        return Segment.Interpolation(expression, filters);
    }

    /// <summary>Découpe sur « | » sans casser les chaînes littérales de l'expression.</summary>
    private static List<string> SplitFilters(string body)
    {
        var parts = new List<string>();
        var current = new StringBuilder();
        char? quote = null;

        foreach (var c in body)
        {
            if (quote is not null)
            {
                current.Append(c);
                if (c == quote)
                {
                    quote = null;
                }

                continue;
            }

            switch (c)
            {
                case '\'':
                case '"':
                    quote = c;
                    current.Append(c);
                    break;
                case '|':
                    parts.Add(current.ToString());
                    current.Clear();
                    break;
                default:
                    current.Append(c);
                    break;
            }
        }

        parts.Add(current.ToString());
        return parts;
    }

    private static readonly HashSet<string> KnownFilters = new(StringComparer.OrdinalIgnoreCase)
    {
        "percent", "bytes", "duration", "seconds", "round", "number", "integer", "upper", "lower", "trim",
    };

    /// <summary>Filtres disponibles, exposés à l'éditeur de règles de l'IHM.</summary>
    public static IReadOnlyList<string> FilterNames { get; } = KnownFilters.Order(StringComparer.Ordinal).ToList();

    private static object? ApplyFilter(object? value, FilterSpec filter)
    {
        if (value is null)
        {
            return filter.Name is "upper" or "lower" or "trim" ? string.Empty : "n/a";
        }

        switch (filter.Name)
        {
            case "percent":
                return ValueOps.TryToNumber(value, out var ratio)
                    ? (ratio * 100).ToString(FormatWithDecimals(filter.Argument, 1), CultureInfo.InvariantCulture) + " %"
                    : value;

            case "bytes":
                return ValueOps.TryToNumber(value, out var bytes) ? FormatBytes(bytes) : value;

            case "duration":
                return ValueOps.TryToNumber(value, out var ms) ? FormatDuration(ms) : value;

            case "seconds":
                return ValueOps.TryToNumber(value, out var seconds) ? FormatDuration(seconds * 1000) : value;

            case "round":
                {
                    if (!ValueOps.TryToNumber(value, out var number))
                    {
                        return value;
                    }

                    var digits = int.TryParse(filter.Argument, out var parsed) ? Math.Clamp(parsed, 0, 15) : 0;
                    return Math.Round(number, digits, MidpointRounding.AwayFromZero);
                }

            case "integer":
                return ValueOps.TryToNumber(value, out var integral) ? (long)Math.Round(integral) : value;

            case "number":
                return ValueOps.TryToNumber(value, out var formatted)
                    ? formatted.ToString(FormatWithDecimals(filter.Argument, 0, grouping: true), CultureInfo.InvariantCulture)
                    : value;

            case "upper":
                return ValueOps.ToInvariantString(value).ToUpperInvariant();

            case "lower":
                return ValueOps.ToInvariantString(value).ToLowerInvariant();

            case "trim":
                return ValueOps.ToInvariantString(value).Trim();

            default:
                return value;
        }
    }

    private static string FormatWithDecimals(string? argument, int fallback, bool grouping = false)
    {
        var decimals = int.TryParse(argument, out var parsed) ? Math.Clamp(parsed, 0, 6) : fallback;
        var prefix = grouping ? "#,##0" : "0";
        return decimals == 0 ? prefix : prefix + "." + new string('0', decimals);
    }

    private static string FormatBytes(double bytes)
    {
        string[] units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
        var magnitude = Math.Abs(bytes);
        var unit = 0;

        while (magnitude >= 1024 && unit < units.Length - 1)
        {
            magnitude /= 1024;
            unit++;
        }

        var sign = bytes < 0 ? "-" : string.Empty;
        var format = unit == 0 ? "0" : "0.#";
        return $"{sign}{magnitude.ToString(format, CultureInfo.InvariantCulture)} {units[unit]}";
    }

    /// <summary>Durée exprimée en millisecondes, unité native de pg_stat_statements.</summary>
    private static string FormatDuration(double milliseconds)
    {
        var absolute = Math.Abs(milliseconds);

        return absolute switch
        {
            < 1 => $"{milliseconds.ToString("0.###", CultureInfo.InvariantCulture)} ms",
            < 1_000 => $"{milliseconds.ToString("0.#", CultureInfo.InvariantCulture)} ms",
            < 60_000 => $"{(milliseconds / 1_000).ToString("0.##", CultureInfo.InvariantCulture)} s",
            < 3_600_000 => $"{(milliseconds / 60_000).ToString("0.#", CultureInfo.InvariantCulture)} min",
            < 86_400_000 => $"{(milliseconds / 3_600_000).ToString("0.#", CultureInfo.InvariantCulture)} h",
            _ => $"{(milliseconds / 86_400_000).ToString("0.#", CultureInfo.InvariantCulture)} j",
        };
    }

    private readonly record struct FilterSpec(string Name, string? Argument);

    private sealed record Segment(string? Text, Expr? Expression, IReadOnlyList<FilterSpec> Filters)
    {
        public static Segment Literal(string text) => new(text, null, []);

        public static Segment Interpolation(Expr expression, IReadOnlyList<FilterSpec> filters) =>
            new(null, expression, filters);
    }
}
