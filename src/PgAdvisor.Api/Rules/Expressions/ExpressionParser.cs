using System.Globalization;
using System.Text;

namespace PgAdvisor.Api.Rules.Expressions;

/// <summary>
/// Analyseur du langage de conditions des règles. Volontairement restreint : aucune boucle,
/// aucun accès au système, uniquement des expressions sur les colonnes du SELECT et les
/// paramètres de la règle. Une règle ne peut donc pas déborder de son rôle d'évaluation.
/// </summary>
public static class ExpressionParser
{
    private static readonly HashSet<string> KnownFunctions = new(StringComparer.OrdinalIgnoreCase)
    {
        "coalesce", "abs", "round", "greatest", "least", "length", "lower", "upper", "contains",
    };

    /// <summary>Fonctions disponibles, exposées à l'éditeur de règles de l'IHM.</summary>
    public static IReadOnlyList<string> FunctionNames { get; } = KnownFunctions.Order(StringComparer.Ordinal).ToList();

    public static Expr Parse(string source)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(source);

        var tokens = Tokenize(source);
        var position = 0;
        var expression = ParseOr(tokens, ref position);

        if (tokens[position].Kind != TokenKind.End)
        {
            throw new ExpressionException($"Unexpected token \"{tokens[position].Text}\" at position {tokens[position].Position}.");
        }

        return expression;
    }

    public static bool TryParse(string source, out Expr? expression, out string? error)
    {
        try
        {
            expression = Parse(source);
            error = null;
            return true;
        }
        catch (Exception ex) when (ex is ExpressionException or ArgumentException)
        {
            expression = null;
            error = ex.Message;
            return false;
        }
    }

    // --- Analyse syntaxique ---------------------------------------------------

    private static Expr ParseOr(List<Token> tokens, ref int position)
    {
        var left = ParseAnd(tokens, ref position);

        while (Match(tokens, ref position, TokenKind.Keyword, "or"))
        {
            left = new LogicalExpr(left, IsAnd: false, ParseAnd(tokens, ref position));
        }

        return left;
    }

    private static Expr ParseAnd(List<Token> tokens, ref int position)
    {
        var left = ParseNot(tokens, ref position);

        while (Match(tokens, ref position, TokenKind.Keyword, "and"))
        {
            left = new LogicalExpr(left, IsAnd: true, ParseNot(tokens, ref position));
        }

        return left;
    }

    private static Expr ParseNot(List<Token> tokens, ref int position)
    {
        if (Match(tokens, ref position, TokenKind.Keyword, "not"))
        {
            return new NotExpr(ParseNot(tokens, ref position));
        }

        return ParseComparison(tokens, ref position);
    }

    private static Expr ParseComparison(List<Token> tokens, ref int position)
    {
        var left = ParseAdditive(tokens, ref position);

        // Forme SQL « x is null » / « x is not null ».
        if (Match(tokens, ref position, TokenKind.Keyword, "is"))
        {
            var negated = Match(tokens, ref position, TokenKind.Keyword, "not");
            Expect(tokens, ref position, TokenKind.Keyword, "null");
            return new IsNullExpr(left, negated);
        }

        var current = tokens[position];
        if (current.Kind != TokenKind.Operator)
        {
            return left;
        }

        var op = current.Text switch
        {
            "==" or "=" => ComparisonOperator.Equal,
            "!=" or "<>" => ComparisonOperator.NotEqual,
            "<" => ComparisonOperator.Less,
            "<=" => ComparisonOperator.LessOrEqual,
            ">" => ComparisonOperator.Greater,
            ">=" => ComparisonOperator.GreaterOrEqual,
            _ => (ComparisonOperator?)null,
        };

        if (op is null)
        {
            return left;
        }

        position++;
        return new ComparisonExpr(left, op.Value, ParseAdditive(tokens, ref position));
    }

    private static Expr ParseAdditive(List<Token> tokens, ref int position)
    {
        var left = ParseMultiplicative(tokens, ref position);

        while (tokens[position].Kind == TokenKind.Operator && tokens[position].Text is "+" or "-")
        {
            var op = tokens[position].Text == "+" ? ArithmeticOperator.Add : ArithmeticOperator.Subtract;
            position++;
            left = new ArithmeticExpr(left, op, ParseMultiplicative(tokens, ref position));
        }

        return left;
    }

    private static Expr ParseMultiplicative(List<Token> tokens, ref int position)
    {
        var left = ParseUnary(tokens, ref position);

        while (tokens[position].Kind == TokenKind.Operator && tokens[position].Text is "*" or "/" or "%")
        {
            var op = tokens[position].Text switch
            {
                "*" => ArithmeticOperator.Multiply,
                "/" => ArithmeticOperator.Divide,
                _ => ArithmeticOperator.Modulo,
            };
            position++;
            left = new ArithmeticExpr(left, op, ParseUnary(tokens, ref position));
        }

        return left;
    }

    private static Expr ParseUnary(List<Token> tokens, ref int position)
    {
        if (tokens[position].Kind == TokenKind.Operator && tokens[position].Text == "-")
        {
            position++;
            return new NegateExpr(ParseUnary(tokens, ref position));
        }

        if (tokens[position].Kind == TokenKind.Operator && tokens[position].Text == "+")
        {
            position++;
            return ParseUnary(tokens, ref position);
        }

        return ParsePostfix(tokens, ref position);
    }

    private static Expr ParsePostfix(List<Token> tokens, ref int position)
    {
        var operand = ParsePrimary(tokens, ref position);

        while (tokens[position].Kind == TokenKind.Operator && tokens[position].Text == "::")
        {
            position++;
            var type = tokens[position];
            if (type.Kind is not (TokenKind.Identifier or TokenKind.Keyword))
            {
                throw new ExpressionException($"A type is expected after :: at position {type.Position}.");
            }

            position++;
            operand = new CastExpr(operand, type.Text);
        }

        return operand;
    }

    private static Expr ParsePrimary(List<Token> tokens, ref int position)
    {
        var token = tokens[position];

        switch (token.Kind)
        {
            case TokenKind.Number:
                position++;
                return new LiteralExpr(double.Parse(token.Text, CultureInfo.InvariantCulture));

            case TokenKind.String:
                position++;
                return new LiteralExpr(token.Text);

            case TokenKind.Keyword when token.Text is "true" or "false":
                position++;
                return new LiteralExpr(token.Text == "true");

            case TokenKind.Keyword when token.Text == "null":
                position++;
                return new LiteralExpr(null);

            case TokenKind.Identifier:
                position++;
                if (tokens[position].Kind == TokenKind.Punctuation && tokens[position].Text == "(")
                {
                    return ParseFunctionCall(tokens, ref position, token);
                }

                return new VariableExpr(token.Text);

            case TokenKind.Punctuation when token.Text == "(":
                position++;
                var inner = ParseOr(tokens, ref position);
                Expect(tokens, ref position, TokenKind.Punctuation, ")");
                return inner;

            default:
                throw new ExpressionException(
                    token.Kind == TokenKind.End
                        ? "Incomplete expression."
                        : $"Unexpected token \"{token.Text}\" at position {token.Position}.");
        }
    }

    private static Expr ParseFunctionCall(List<Token> tokens, ref int position, Token name)
    {
        if (!KnownFunctions.Contains(name.Text))
        {
            throw new ExpressionException(
                $"Unknown function \"{name.Text}\". Available: {string.Join(", ", KnownFunctions.Order())}.");
        }

        position++; // consomme '('
        var arguments = new List<Expr>();

        if (!(tokens[position].Kind == TokenKind.Punctuation && tokens[position].Text == ")"))
        {
            do
            {
                arguments.Add(ParseOr(tokens, ref position));
            }
            while (Match(tokens, ref position, TokenKind.Punctuation, ","));
        }

        Expect(tokens, ref position, TokenKind.Punctuation, ")");
        return new FunctionExpr(name.Text.ToLowerInvariant(), arguments);
    }

    private static bool Match(List<Token> tokens, ref int position, TokenKind kind, string text)
    {
        if (tokens[position].Kind == kind &&
            string.Equals(tokens[position].Text, text, StringComparison.OrdinalIgnoreCase))
        {
            position++;
            return true;
        }

        return false;
    }

    private static void Expect(List<Token> tokens, ref int position, TokenKind kind, string text)
    {
        if (!Match(tokens, ref position, kind, text))
        {
            throw new ExpressionException(
                $"Expected \"{text}\" at position {tokens[position].Position} but found \"{tokens[position].Text}\".");
        }
    }

    // --- Analyse lexicale ----------------------------------------------------

    private enum TokenKind { Number, String, Identifier, Keyword, Operator, Punctuation, End }

    private readonly record struct Token(TokenKind Kind, string Text, int Position);

    private static readonly string[] Keywords = ["and", "or", "not", "is", "null", "true", "false"];

    private static List<Token> Tokenize(string source)
    {
        var tokens = new List<Token>();
        var index = 0;

        while (index < source.Length)
        {
            var c = source[index];

            if (char.IsWhiteSpace(c))
            {
                index++;
                continue;
            }

            if (char.IsDigit(c) || (c == '.' && index + 1 < source.Length && char.IsDigit(source[index + 1])))
            {
                var start = index;
                while (index < source.Length && (char.IsDigit(source[index]) || source[index] == '.'))
                {
                    index++;
                }

                // Notation exponentielle : 1e6, 2.5e-3.
                if (index < source.Length && (source[index] == 'e' || source[index] == 'E'))
                {
                    var save = index;
                    index++;
                    if (index < source.Length && (source[index] == '+' || source[index] == '-'))
                    {
                        index++;
                    }

                    if (index < source.Length && char.IsDigit(source[index]))
                    {
                        while (index < source.Length && char.IsDigit(source[index]))
                        {
                            index++;
                        }
                    }
                    else
                    {
                        index = save;
                    }
                }

                var text = source[start..index];
                if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out _))
                {
                    throw new ExpressionException($"Invalid number \"{text}\" at position {start}.");
                }

                tokens.Add(new Token(TokenKind.Number, text, start));
                continue;
            }

            if (c is '\'' or '"')
            {
                var quote = c;
                var start = index;
                index++;
                var builder = new StringBuilder();

                while (index < source.Length && source[index] != quote)
                {
                    // Doublement du délimiteur pour l'échapper, comme en SQL.
                    if (source[index] == '\\' && index + 1 < source.Length)
                    {
                        builder.Append(source[index + 1]);
                        index += 2;
                        continue;
                    }

                    builder.Append(source[index]);
                    index++;
                }

                if (index >= source.Length)
                {
                    throw new ExpressionException($"Unterminated string at position {start}.");
                }

                index++; // consomme le délimiteur fermant
                tokens.Add(new Token(TokenKind.String, builder.ToString(), start));
                continue;
            }

            if (char.IsLetter(c) || c == '_')
            {
                var start = index;
                while (index < source.Length && (char.IsLetterOrDigit(source[index]) || source[index] is '_' or '.'))
                {
                    index++;
                }

                var text = source[start..index];
                var kind = Keywords.Contains(text, StringComparer.OrdinalIgnoreCase)
                    ? TokenKind.Keyword
                    : TokenKind.Identifier;

                tokens.Add(new Token(kind, kind == TokenKind.Keyword ? text.ToLowerInvariant() : text, start));
                continue;
            }

            if (c == ':' && index + 1 < source.Length && source[index + 1] == ':')
            {
                tokens.Add(new Token(TokenKind.Operator, "::", index));
                index += 2;
                continue;
            }

            var twoChar = index + 1 < source.Length ? source.Substring(index, 2) : string.Empty;
            if (twoChar is ">=" or "<=" or "==" or "!=" or "<>")
            {
                tokens.Add(new Token(TokenKind.Operator, twoChar, index));
                index += 2;
                continue;
            }

            if (c is '>' or '<' or '=' or '+' or '-' or '*' or '/' or '%')
            {
                tokens.Add(new Token(TokenKind.Operator, c.ToString(), index));
                index++;
                continue;
            }

            if (c is '(' or ')' or ',')
            {
                tokens.Add(new Token(TokenKind.Punctuation, c.ToString(), index));
                index++;
                continue;
            }

            throw new ExpressionException($"Unexpected character \"{c}\" at position {index}.");
        }

        tokens.Add(new Token(TokenKind.End, "end of expression", source.Length));
        return tokens;
    }
}
