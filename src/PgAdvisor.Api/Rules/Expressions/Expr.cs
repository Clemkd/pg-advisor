namespace PgAdvisor.Api.Rules.Expressions;

/// <summary>Nœud d'expression évaluable contre les colonnes d'une ligne et les paramètres d'une règle.</summary>
public abstract record Expr
{
    public abstract object? Evaluate(IReadOnlyDictionary<string, object?> variables);

    /// <summary>Identifiants référencés, utilisés pour valider une règle contre son SELECT.</summary>
    public abstract IEnumerable<string> References();
}

public sealed record LiteralExpr(object? Value) : Expr
{
    public override object? Evaluate(IReadOnlyDictionary<string, object?> variables) => Value;
    public override IEnumerable<string> References() => [];
}

public sealed record VariableExpr(string Name) : Expr
{
    public override object? Evaluate(IReadOnlyDictionary<string, object?> variables) =>
        variables.TryGetValue(Name, out var value) ? value : null;

    public override IEnumerable<string> References() => [Name];
}

public sealed record CastExpr(Expr Operand, string Type) : Expr
{
    public override object? Evaluate(IReadOnlyDictionary<string, object?> variables) =>
        ValueOps.Cast(Operand.Evaluate(variables), Type);

    public override IEnumerable<string> References() => Operand.References();
}

public sealed record NegateExpr(Expr Operand) : Expr
{
    public override object? Evaluate(IReadOnlyDictionary<string, object?> variables)
    {
        var value = Operand.Evaluate(variables);
        return ValueOps.TryToNumber(value, out var number) ? -number : null;
    }

    public override IEnumerable<string> References() => Operand.References();
}

public sealed record NotExpr(Expr Operand) : Expr
{
    public override object? Evaluate(IReadOnlyDictionary<string, object?> variables) =>
        !ValueOps.ToBool(Operand.Evaluate(variables));

    public override IEnumerable<string> References() => Operand.References();
}

public enum ArithmeticOperator { Add, Subtract, Multiply, Divide, Modulo }

public sealed record ArithmeticExpr(Expr Left, ArithmeticOperator Operator, Expr Right) : Expr
{
    public override object? Evaluate(IReadOnlyDictionary<string, object?> variables)
    {
        var leftValue = Left.Evaluate(variables);
        var rightValue = Right.Evaluate(variables);

        // Concaténation lorsque l'addition porte sur du texte.
        if (Operator == ArithmeticOperator.Add && (leftValue is string || rightValue is string))
        {
            return ValueOps.ToInvariantString(leftValue) + ValueOps.ToInvariantString(rightValue);
        }

        if (!ValueOps.TryToNumber(leftValue, out var left) || !ValueOps.TryToNumber(rightValue, out var right))
        {
            return null;
        }

        return Operator switch
        {
            ArithmeticOperator.Add => left + right,
            ArithmeticOperator.Subtract => left - right,
            ArithmeticOperator.Multiply => left * right,
            // Division par zéro : null plutôt qu'une exception, comme NULLIF côté SQL.
            ArithmeticOperator.Divide => right == 0 ? null : left / right,
            ArithmeticOperator.Modulo => right == 0 ? null : left % right,
            _ => null,
        };
    }

    public override IEnumerable<string> References() => Left.References().Concat(Right.References());
}

public enum ComparisonOperator { Equal, NotEqual, Less, LessOrEqual, Greater, GreaterOrEqual }

public sealed record ComparisonExpr(Expr Left, ComparisonOperator Operator, Expr Right) : Expr
{
    public override object? Evaluate(IReadOnlyDictionary<string, object?> variables)
    {
        var left = Left.Evaluate(variables);
        var right = Right.Evaluate(variables);

        if (Operator == ComparisonOperator.Equal)
        {
            return ValueOps.AreEqual(left, right);
        }

        if (Operator == ComparisonOperator.NotEqual)
        {
            return !ValueOps.AreEqual(left, right);
        }

        var comparison = ValueOps.Compare(left, right);
        if (comparison is null)
        {
            // Non comparable (typiquement une métrique NULL) : la condition n'est pas satisfaite.
            return false;
        }

        return Operator switch
        {
            ComparisonOperator.Less => comparison < 0,
            ComparisonOperator.LessOrEqual => comparison <= 0,
            ComparisonOperator.Greater => comparison > 0,
            ComparisonOperator.GreaterOrEqual => comparison >= 0,
            _ => false,
        };
    }

    public override IEnumerable<string> References() => Left.References().Concat(Right.References());
}

public sealed record LogicalExpr(Expr Left, bool IsAnd, Expr Right) : Expr
{
    public override object? Evaluate(IReadOnlyDictionary<string, object?> variables)
    {
        var left = ValueOps.ToBool(Left.Evaluate(variables));

        // Court-circuit : une branche non évaluée ne peut pas lever.
        if (IsAnd)
        {
            return left && ValueOps.ToBool(Right.Evaluate(variables));
        }

        return left || ValueOps.ToBool(Right.Evaluate(variables));
    }

    public override IEnumerable<string> References() => Left.References().Concat(Right.References());
}

public sealed record IsNullExpr(Expr Operand, bool Negated) : Expr
{
    public override object? Evaluate(IReadOnlyDictionary<string, object?> variables)
    {
        var isNull = Operand.Evaluate(variables) is null;
        return Negated ? !isNull : isNull;
    }

    public override IEnumerable<string> References() => Operand.References();
}

public sealed record FunctionExpr(string Name, IReadOnlyList<Expr> Arguments) : Expr
{
    public override object? Evaluate(IReadOnlyDictionary<string, object?> variables)
    {
        var values = Arguments.Select(a => a.Evaluate(variables)).ToArray();

        switch (Name)
        {
            case "coalesce":
                return values.FirstOrDefault(v => v is not null);

            case "abs":
                return ValueOps.TryToNumber(values.ElementAtOrDefault(0), out var abs) ? Math.Abs(abs) : null;

            case "round":
                {
                    if (!ValueOps.TryToNumber(values.ElementAtOrDefault(0), out var value))
                    {
                        return null;
                    }

                    var digits = ValueOps.TryToNumber(values.ElementAtOrDefault(1), out var d) ? (int)d : 0;
                    return Math.Round(value, Math.Clamp(digits, 0, 15), MidpointRounding.AwayFromZero);
                }

            case "greatest":
                return values.Where(v => v is not null)
                    .OrderByDescending(v => v, Comparer<object?>.Create((a, b) => ValueOps.Compare(a, b) ?? 0))
                    .FirstOrDefault();

            case "least":
                return values.Where(v => v is not null)
                    .OrderBy(v => v, Comparer<object?>.Create((a, b) => ValueOps.Compare(a, b) ?? 0))
                    .FirstOrDefault();

            case "length":
                return (double)ValueOps.ToInvariantString(values.ElementAtOrDefault(0)).Length;

            case "lower":
                return ValueOps.ToInvariantString(values.ElementAtOrDefault(0)).ToLowerInvariant();

            case "upper":
                return ValueOps.ToInvariantString(values.ElementAtOrDefault(0)).ToUpperInvariant();

            case "contains":
                return ValueOps.ToInvariantString(values.ElementAtOrDefault(0))
                    .Contains(ValueOps.ToInvariantString(values.ElementAtOrDefault(1)), StringComparison.OrdinalIgnoreCase);

            default:
                throw new ExpressionException($"Fonction inconnue : {Name}()");
        }
    }

    public override IEnumerable<string> References() => Arguments.SelectMany(a => a.References());
}
