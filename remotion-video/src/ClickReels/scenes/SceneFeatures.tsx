import React from "react";
import { FEATURES } from "../copy";
import { sceneAt } from "../lib/timeline";
import { FeatureScene } from "./FeatureScene";
import { MockPortaria } from "../ui/MockPortaria";
import { MockAreas } from "../ui/MockAreas";
import { MockFinanceiro } from "../ui/MockFinanceiro";
import { MockChatIA } from "../ui/MockChatIA";

/**
 * As quatro cenas de produto.
 * Cada uma é um wrapper fino: copy + acento + a tela fake correspondente.
 * O `tilt` alterna de sinal para o device nunca repetir o mesmo ângulo.
 */

export const ScenePortaria: React.FC = () => (
  <FeatureScene {...FEATURES.portaria} accent={sceneAt("portaria").accent} tilt={-4}>
    <MockPortaria />
  </FeatureScene>
);

export const SceneAreas: React.FC = () => (
  <FeatureScene {...FEATURES.areas} accent={sceneAt("areas").accent} tilt={4}>
    <MockAreas />
  </FeatureScene>
);

export const SceneFinanceiro: React.FC = () => (
  <FeatureScene {...FEATURES.financeiro} accent={sceneAt("financeiro").accent} tilt={-4}>
    <MockFinanceiro />
  </FeatureScene>
);

export const SceneClickIA: React.FC = () => (
  <FeatureScene {...FEATURES.ia} accent={sceneAt("ia").accent} tilt={4}>
    <MockChatIA />
  </FeatureScene>
);
