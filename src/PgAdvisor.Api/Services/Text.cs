namespace PgAdvisor.Api.Services;

/// <summary>
/// Découpes de chaînes partagées. Elles vivaient recopiées dans trois fichiers, avec des
/// sémantiques légèrement différentes — l'une rendait <c>max + 1</c> caractères, l'autre
/// <c>max</c> — ce qui est plus gênant qu'une duplication franche : le nom promettait la même
/// chose partout.
/// </summary>
public static class Text
{
    /// <summary>
    /// Tronque en incluant l'ellipse dans la limite : le résultat ne dépasse jamais
    /// <paramref name="max"/> caractères.
    /// </summary>
    public static string Ellipsis(string value, int max)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(max, 1);

        return value.Length <= max ? value : value[..(max - 1)] + "…";
    }

    /// <summary>
    /// Coupe net, sans rien ajouter, et laisse passer <c>null</c>. Destinée au stockage d'un
    /// message d'erreur en base, où l'ellipse n'apporterait rien et où la colonne est bornée.
    /// </summary>
    public static string? Clip(string? value, int max) =>
        value is null || value.Length <= max ? value : value[..max];
}
