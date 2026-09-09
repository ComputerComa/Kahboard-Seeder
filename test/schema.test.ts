import assert from "node:assert/strict";
import test from "node:test";
import { ProjectSchema } from "../src/schema.js";

test("rejects dependency cycles", () => {
    const result = ProjectSchema.safeParse({
        version: 1,
        project: { identifier: "CYCLE", name: "Cycle" },
        columns: ["Backlog"],
        tasks: [
            { id: "one", reference: "ONE-1", title: "One", column: "Backlog", depends_on: ["two"] },
            { id: "two", reference: "TWO-1", title: "Two", column: "Backlog", depends_on: ["one"] },
        ],
    });

    assert.equal(result.success, false);
    if (!result.success) {
        assert.match(result.error.issues.map(issue => issue.message).join("\n"), /cycle/i);
    }
});

test("rejects duplicate column aliases", () => {
    assert.throws(
        () => ProjectSchema.parse({
            version: 1,
            project: {
                identifier: "TESTBOARD",
                name: "Test board",
            },
            columns: ["In Progress", "Work in progress"],
            tasks: [{
                id: "first-task",
                reference: "TEST-001",
                title: "First task",
                column: "In Progress",
            }],
        }),
        /Project columns must be unique, including aliases/,
    );
});
