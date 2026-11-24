import React from 'react';
import { Composition, staticFile } from 'remotion';
import scriptData from '../script.json';
import { VideoComposition } from './VideoComposition';

const BUNDLED_FONT_CSS = `
@font-face {
  font-family: 'Noto Sans SC';
  src: url('${staticFile('fonts/NotoSansSC-VF.woff2')}') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Source Han Serif SC Heavy';
  src: url('${staticFile('fonts/SourceHanSerifSC-Heavy.woff2')}') format('woff2');
  font-weight: 900;
  font-style: normal;
  font-display: swap;
}
`;

export const RemotionRoot: React.FC = () => {
  const sData: any = scriptData;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: BUNDLED_FONT_CSS }} />
      <Composition
        id="MainVideo"
        component={VideoComposition}
        durationInFrames={Math.max(30, Number(sData.totalDurationInFrames) || 300)}
        fps={Number(sData.fps) || 30}
        width={Number(sData.width) || 1920}
        height={Number(sData.height) || 1080}
      />
    </>
  );
};
