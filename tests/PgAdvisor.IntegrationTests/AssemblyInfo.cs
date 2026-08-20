// The factories publish their settings as process-wide environment variables, because Program.cs
// snapshots its configuration before a test host can add a source. Two suites running at once
// would therefore share one data directory.
[assembly: Xunit.CollectionBehavior(DisableTestParallelization = true)]
