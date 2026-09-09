import assert from "node:assert/strict";
import test from "node:test";
import {
    defaultReferencePrefix,
    slugifyIdentifier,
    slugifyTaskId,
    uniqueSlug,
} from "../src/guidedBuilder.js";

test("generates Kanboard-safe project identifiers", () => {
    assert.equal(slugifyIdentifier("Homelab Server Migration"), "HOMELABSERVERMIGRATION");
    assert.equal(slugifyIdentifier("!!!"), "PROJECT");
});

test("generates task slugs and unique variants", () => {
    assert.equal(slugifyTaskId("Initial setup - new NAS"), "initial-setup-new-nas");
    assert.equal(uniqueSlug("initial-setup", ["initial-setup", "initial-setup-2"]), "initial-setup-3");
});

test("generates short phase reference prefixes", () => {
    assert.equal(defaultReferencePrefix("NAS migration"), "NM");
    assert.equal(defaultReferencePrefix("Proxmox"), "PROX");
});
