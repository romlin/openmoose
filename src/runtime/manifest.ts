/**
 * Core Skill Manifest - Centralized registry of vetted host-access skills.
 * Implementation of the "Quadruple-Lock" Integrity Policy:
 * 1. Location (src/runtime/skills/builtins)
 * 2. Manifest Membership (Is listed in CORE_SKILL_MANIFEST)
 * 3. Filestem Integrity (Skill name matches filename)
 * 4. Scavenging Proof (Must be a valid exported Skill object)
 */

export interface CoreSkillDefinition {
    name: string;
    expectedFilename?: string; // Optional: Enforcement for filestem integrity
}

/**
 * The official list of skills vetted for host-mode execution.
 */
export const CORE_SKILL_MANIFEST: CoreSkillDefinition[] = [
    { name: 'ls', expectedFilename: 'ls' },
    { name: 'read', expectedFilename: 'read' },
    { name: 'file_write', expectedFilename: 'write' },
    { name: 'shell_execute', expectedFilename: 'shell' },
    { name: 'python_execute', expectedFilename: 'python' },
    { name: 'browser_action', expectedFilename: 'browser' },
    { name: 'memory_store', expectedFilename: 'memory' },
    { name: 'memory_recall', expectedFilename: 'memory' }
];

/**
 * Check if a skill name is on the vetted manifest.
 */
export function isVettedCoreSkill(name: string): boolean {
    return CORE_SKILL_MANIFEST.some(s => s.name === name);
}

/**
 * Verify filestem integrity against the manifest.
 */
export function verifyFilestemIntegrity(name: string, filename: string): boolean {
    const def = CORE_SKILL_MANIFEST.find(s => s.name === name);
    if (!def) return false;
    if (!def.expectedFilename) return true; // No filename constraint
    return filename === def.expectedFilename;
}
