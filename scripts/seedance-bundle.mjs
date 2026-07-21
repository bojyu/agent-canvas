import {
  PROMPT_SKILL_DEFINITIONS,
  loadPromptSkillBundle,
  materializeIsolatedPromptSkillBundle,
  promptSkillDocument,
  promptSkillInstructions,
} from "./skill-bundle.mjs";

export const SEEDANCE_REFERENCE_FILES = PROMPT_SKILL_DEFINITIONS.seedance.referenceFiles;
export const SEEDANCE_PRELOADED_REFERENCE_FILES = PROMPT_SKILL_DEFINITIONS.seedance.preloadedReferenceFiles;

export async function loadSeedanceBundle(skillPath) {
  return loadPromptSkillBundle("seedance", skillPath);
}

export function seedanceDocument(bundle, name) {
  return promptSkillDocument(bundle, name);
}

export function seedanceInstructions(bundle, { includeAllReferences = false } = {}) {
  return promptSkillInstructions(bundle, { includeAllReferences });
}

export async function materializeIsolatedSeedanceBundle(bundle) {
  return materializeIsolatedPromptSkillBundle(bundle);
}
