const COLUMN_ALIASES = new Map<string, string>([
    ["inprogress", "workinprogress"],
    ["wip", "workinprogress"],
]);

export function columnKey(title: string): string {
    const key = title
        .trim()
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "");

    return COLUMN_ALIASES.get(key) ?? key;
}

export function findColumnId(
    columns: Map<string, number>,
    title: string,
): number | undefined {
    const exact = columns.get(title);
    if (exact !== undefined) return exact;

    const targetKey = columnKey(title);
    for (const [existingTitle, id] of columns) {
        if (columnKey(existingTitle) === targetKey) return id;
    }

    return undefined;
}
