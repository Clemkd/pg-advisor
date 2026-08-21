using Microsoft.Extensions.Logging.Abstractions;
using PgAdvisor.Api.Rules;
using PgAdvisor.Api.Rules.Handlers;

namespace PgAdvisor.Tests;

/// <summary>
/// The rules shipped in <c>rules/</c> are compiled at startup by <see cref="RuleStore"/>, which
/// discards an invalid one instead of failing: a broken rule silently disappears from the product.
/// These tests are the only thing standing between a typo and a rule nobody notices is gone.
/// </summary>
public class BundledRuleTests
{
    private static readonly RuleLoader Loader = new(
        new RuleHandlerRegistry([new MissingExtensionHandler(), new RedundantIndexHandler()]),
        NullLogger<RuleLoader>.Instance);

    private static readonly string RulesDirectory = LocateRulesDirectory();

    public static TheoryData<string> RuleFiles()
    {
        var data = new TheoryData<string>();

        foreach (var path in Directory.EnumerateFiles(RulesDirectory, "*.yaml"))
        {
            data.Add(Path.GetFileName(path));
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(RuleFiles))]
    public void EachBundledRuleCompiles(string fileName)
    {
        var path = Path.Combine(RulesDirectory, fileName);
        var compilation = Loader.Compile(File.ReadAllText(path), path, RuleOrigin.Provided);

        Assert.True(
            compilation.Succeeded,
            $"{fileName} does not compile: {string.Join(" | ", compilation.Errors)}");
    }

    [Fact]
    public void TheBundledDirectoryLoadsWithoutError()
    {
        var (rules, errors) = Loader.LoadDirectory(RulesDirectory, RuleOrigin.Provided);

        Assert.Empty(errors);
        Assert.Equal(Directory.GetFiles(RulesDirectory, "*.yaml").Length, rules.Count);
    }

    /// <summary>A duplicate id would silently shadow one of the two rules once loaded.</summary>
    [Fact]
    public void BundledRuleIdsAreUnique()
    {
        var (rules, _) = Loader.LoadDirectory(RulesDirectory, RuleOrigin.Provided);

        var duplicates = rules
            .GroupBy(rule => rule.Id, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();

        Assert.Empty(duplicates);
    }

    /// <summary>
    /// The file name carries the id: an operator reading a diagnostic looks for the matching file,
    /// and <see cref="RuleFileService"/> writes user rules under that very convention.
    /// </summary>
    [Theory]
    [MemberData(nameof(RuleFiles))]
    public void TheFileNameMatchesTheRuleId(string fileName)
    {
        var path = Path.Combine(RulesDirectory, fileName);
        var compilation = Loader.Compile(File.ReadAllText(path), path, RuleOrigin.Provided);

        Assert.NotNull(compilation.Rule);
        Assert.Equal(Path.GetFileNameWithoutExtension(fileName), compilation.Rule.Id);
    }

    /// <summary>
    /// L'identifiant porte la catégorie. Le préfixe et le champ avaient déjà divergé une fois —
    /// une règle nommée vacuum.* classée en statistics — et comme le score de santé agrège par
    /// catégorie, la divergence se lit sur le tableau de bord sans que rien ne la signale.
    /// </summary>
    [Theory]
    [MemberData(nameof(RuleFiles))]
    public void TheIdPrefixMatchesTheCategory(string fileName)
    {
        var path = Path.Combine(RulesDirectory, fileName);
        var compilation = Loader.Compile(File.ReadAllText(path), path, RuleOrigin.Provided);

        Assert.NotNull(compilation.Rule);

        var prefix = compilation.Rule.Id.Split('.')[0];
        Assert.Equal(prefix, compilation.Rule.Category);
    }

    private static string LocateRulesDirectory()
    {
        // The tests run from bin/, the rules live at the repository root: walk up to the solution.
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "rules");
            if (File.Exists(Path.Combine(directory.FullName, "PgAdvisor.slnx")) && Directory.Exists(candidate))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        throw new InvalidOperationException("Repository root not found: no PgAdvisor.slnx above the test assembly.");
    }
}
