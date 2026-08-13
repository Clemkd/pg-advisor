using System.Text;

namespace PgAdvisor.Api.Rules;

/// <summary>
/// Garde-fou syntaxique sur le SQL des règles. La session est déjà forcée en lecture seule
/// côté PostgreSQL ; cette vérification-ci sert à refuser la règle au chargement, avec un
/// message clair, plutôt qu'à laisser l'erreur survenir en production.
/// </summary>
public static class SqlGuard
{
    public static bool Validate(string query, out string? error)
    {
        var stripped = StripLiteralsAndComments(query).Trim();

        if (stripped.Length == 0)
        {
            error = "La requête est vide.";
            return false;
        }

        var withoutTrailing = stripped.TrimEnd().TrimEnd(';').TrimEnd();
        if (withoutTrailing.Contains(';'))
        {
            error = "Une règle ne peut contenir qu'une seule requête : « ; » interdit en dehors de la fin.";
            return false;
        }

        var firstWord = new string(withoutTrailing.TakeWhile(char.IsLetter).ToArray());
        if (!firstWord.Equals("select", StringComparison.OrdinalIgnoreCase) &&
            !firstWord.Equals("with", StringComparison.OrdinalIgnoreCase) &&
            !firstWord.Equals("table", StringComparison.OrdinalIgnoreCase) &&
            !firstWord.Equals("explain", StringComparison.OrdinalIgnoreCase))
        {
            error = $"La requête doit commencer par SELECT, WITH, TABLE ou EXPLAIN (trouvé « {firstWord} »).";
            return false;
        }

        error = null;
        return true;
    }

    /// <summary>
    /// Remplace les littéraux et commentaires par des espaces afin que la détection de « ; »
    /// ne se déclenche pas sur un point-virgule contenu dans une chaîne ou un commentaire.
    /// </summary>
    private static string StripLiteralsAndComments(string sql)
    {
        var builder = new StringBuilder(sql.Length);
        var index = 0;

        while (index < sql.Length)
        {
            var c = sql[index];

            // Commentaire de fin de ligne.
            if (c == '-' && index + 1 < sql.Length && sql[index + 1] == '-')
            {
                while (index < sql.Length && sql[index] != '\n')
                {
                    index++;
                }

                continue;
            }

            // Commentaire de bloc, imbrication autorisée comme en PostgreSQL.
            if (c == '/' && index + 1 < sql.Length && sql[index + 1] == '*')
            {
                var depth = 1;
                index += 2;
                while (index < sql.Length && depth > 0)
                {
                    if (sql[index] == '/' && index + 1 < sql.Length && sql[index + 1] == '*')
                    {
                        depth++;
                        index += 2;
                    }
                    else if (sql[index] == '*' && index + 1 < sql.Length && sql[index + 1] == '/')
                    {
                        depth--;
                        index += 2;
                    }
                    else
                    {
                        index++;
                    }
                }

                continue;
            }

            // Chaîne ou identifiant délimité ; le délimiteur doublé reste dans le littéral.
            if (c is '\'' or '"')
            {
                var quote = c;
                index++;
                while (index < sql.Length)
                {
                    if (sql[index] == quote)
                    {
                        if (index + 1 < sql.Length && sql[index + 1] == quote)
                        {
                            index += 2;
                            continue;
                        }

                        index++;
                        break;
                    }

                    index++;
                }

                builder.Append(' ');
                continue;
            }

            // Chaîne délimitée par $$ ou $tag$.
            if (c == '$')
            {
                var closeTag = ReadDollarTag(sql, index);
                if (closeTag is not null)
                {
                    var end = sql.IndexOf(closeTag, index + closeTag.Length, StringComparison.Ordinal);
                    index = end < 0 ? sql.Length : end + closeTag.Length;
                    builder.Append(' ');
                    continue;
                }
            }

            builder.Append(c);
            index++;
        }

        return builder.ToString();
    }

    private static string? ReadDollarTag(string sql, int start)
    {
        var index = start + 1;
        while (index < sql.Length && (char.IsLetterOrDigit(sql[index]) || sql[index] == '_'))
        {
            index++;
        }

        return index < sql.Length && sql[index] == '$' ? sql[start..(index + 1)] : null;
    }
}
