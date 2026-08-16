import type { StepElement } from '@speclynx/apidom-ns-arazzo-1';

import type ArazzoDocument from '../document/ArazzoDocument.ts';

/**
 * Normalizes an extracted Arazzo step.
 *
 * Currently acts as an identity function. Steps are already dereferenced as part
 * of workflow normalization, which also inherits the workflow's `parameters`
 * into them — a step reaching here has no inherited properties left to merge.
 * @public
 */
class ArazzoStepNormalizer {
  /**
   * Normalizes a step element against its parent document.
   */
  async normalize(step: StepElement, _document: ArazzoDocument): Promise<StepElement> {
    return step;
  }
}

export default ArazzoStepNormalizer;
