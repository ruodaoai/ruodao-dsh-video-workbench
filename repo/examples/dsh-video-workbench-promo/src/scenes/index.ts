import React from 'react';
import { BATCH_01_SCENES } from './Batch01';
import { BATCH_02_SCENES } from './Batch02';
import { BATCH_03_SCENES } from './Batch03';
import { BATCH_04_SCENES } from './Batch04';
import { BATCH_05_SCENES } from './Batch05';
import { BATCH_06_SCENES } from './Batch06';
import { BATCH_07_SCENES } from './Batch07';
import { BATCH_08_SCENES } from './Batch08';

export type CustomSceneComp = React.FC<{ scene: any; idx: number; total: number; beats: any[] }>;

export const CUSTOM_SCENE_MAP: Record<string, CustomSceneComp> = {
  ...BATCH_01_SCENES,
  ...BATCH_02_SCENES,
  ...BATCH_03_SCENES,
  ...BATCH_04_SCENES,
  ...BATCH_05_SCENES,
  ...BATCH_06_SCENES,
  ...BATCH_07_SCENES,
  ...BATCH_08_SCENES,
};
