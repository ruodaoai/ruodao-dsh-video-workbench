import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { AppWindow, FocusShot, FONT_SANS, FONT_MONO } from '../lib/shotcraft';

const C: Record<string, string> = {
  bg: '#050608', surface: '#10141E', ink: '#F1F5F9', muted: '#94A3B8',
  blue: '#2F7BFF', ice: '#7DB2FF', gold: '#F5B92E', cyan: '#67E8F9',
};
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const ease = (value: number): number => { const t = clamp(value); return 1 - Math.pow(1 - t, 3); };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const reveal = (frame: number, start: number, length = 12): number => ease((frame - start) / length);

function useMotion(scene: any): { f: number; p: number; pulse: number; fps: number } {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = Math.max(2, Number(scene.durationInFrames) || 107);
  const globalFrame = f + (Number(scene.startSec) || 0) * fps;
  const beatLength = fps * 60 / 118;
  const phase = ((globalFrame % beatLength) + beatLength) % beatLength;
  return { f, p: clamp(f / (duration - 1)), pulse: Math.exp(-phase / 3.4), fps };
}

const ToolGlyph: React.FC<{ kind: number; color: string }> = ({ kind, color }) => {
  if (kind === 0) return <g fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"><path d="M-20-26H10L23-13V27H-20Z" /><path d="M9-25V-12H22M-10-2H12M-10 9H12M-10 20H4" /></g>;
  if (kind === 1) return <g fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"><rect x={-10} y={-28} width={20} height={39} rx={10} /><path d="M-21-4V1A21 21 0 0 0 21 1V-4M0 22V32M-12 32H12" /></g>;
  if (kind === 2) return <g fill="none" stroke={color} strokeWidth={4} strokeLinejoin="round"><rect x={-27} y={-23} width={54} height={46} rx={7} /><path d="M-8-12L13 0L-8 12ZM-27-11H-19M-27 11H-19M19-11H27M19 11H27" /></g>;
  return <g fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"><path d="M0 13V-28M-15-13L0-28L15-13M-26 7V27H26V7M-12 15H12" /></g>;
};

const Scene_scene_01: React.FC<CustomSceneProps> = ({ scene, idx }) => {
  const { f, p, pulse } = useMotion(scene);
  const gather = reveal(f, 10, 26);
  const plate = reveal(f, 24, 18);
  const chain = reveal(f, 48, 18);
  const camera = 1 + p * 0.035 + pulse * 0.005;
  const nodes: { label: string; x: number; y: number; tilt: number; color: string }[] = [
    { label: '脚本', x: 212, y: 630, tilt: -12, color: C.ice },
    { label: '配音', x: 751, y: 585, tilt: 11, color: C.cyan },
    { label: '渲染', x: 206, y: 1100, tilt: -8, color: C.blue },
    { label: '发布', x: 748, y: 1090, tilt: 14, color: C.gold },
  ];
  return <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: FONT_SANS, overflow: 'hidden' }}>
    <svg width="100%" height="100%" viewBox="0 0 1080 1920" style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id={`s1-halo-${idx}`}><stop offset="0" stopColor={C.blue} stopOpacity={0.35} /><stop offset="1" stopColor={C.blue} stopOpacity={0} /></radialGradient>
        <linearGradient id={`s1-metal-${idx}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#FFFFFF" /><stop offset="0.55" stopColor="#CFE1FF" /><stop offset="1" stopColor={C.ice} /></linearGradient>
        <linearGradient id={`s1-panel-${idx}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#16294B" /><stop offset="1" stopColor="#080D17" /></linearGradient>
        <filter id={`s1-glow-${idx}`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="7" /></filter>
      </defs>
      <ellipse cx={480} cy={850} rx={610} ry={710} fill={`url(#s1-halo-${idx})`} />
      <g opacity={0.14} stroke={C.ice} strokeWidth={1}>
        {Array.from({ length: 14 }, (_value: unknown, i: number) => <path key={i} d={`M${-400 + i * 140 + p * 28} 220L${240 + i * 53 + p * 10} 1470`} />)}
        {Array.from({ length: 12 }, (_value: unknown, i: number) => <path key={i} d={`M30 ${480 + i * 79 + (f * 0.8) % 79}H950`} opacity={0.3 + i * 0.035} />)}
      </g>
      <text x={82} y={265} fill={C.ice} fontFamily={FONT_MONO} fontSize={22} letterSpacing={4}>DSH / VIDEO WORKBENCH</text>
      <g opacity={reveal(f, 0, 9)} transform={`translate(${(1 - reveal(f, 0, 12)) * -38} 0)`}>
        <text x={78} y={365} fill={C.ink} fontSize={76} fontWeight={900}>别再把时间</text>
        <text x={78} y={456} fill={C.ink} fontSize={76} fontWeight={900}>耗在<tspan fill={C.ice}>拼工具</tspan></text>
        <path d={`M82 484H${82 + 645 * reveal(f, 5, 19)}`} stroke={C.blue} strokeWidth={5} />
      </g>
      <g transform={`translate(475 850) scale(${camera}) translate(-475 -850)`}>
        {[0, 1, 2].map((i: number) => {
          const cycle = ((f * 0.012 + i / 3) % 1);
          return <ellipse key={i} cx={475} cy={850} rx={120 + cycle * 360} ry={65 + cycle * 220} fill="none" stroke={C.ice} strokeWidth={1.5} opacity={(1 - cycle) * 0.3} />;
        })}
        {nodes.map((node: { label: string; x: number; y: number; tilt: number; color: string }, i: number) => {
          const x = lerp(node.x, 475, gather);
          const y = lerp(node.y, 850, gather) + Math.sin(f * 0.08 + i) * 5 * (1 - gather);
          const opacity = 1 - reveal(f, 29, 10);
          return <g key={node.label} opacity={opacity}>
            <path d={`M${x} ${y}Q475 ${650 + i * 90} 475 850`} stroke={node.color} strokeWidth={2 + pulse * 2} strokeDasharray="8 14" strokeDashoffset={-f * 5} fill="none" opacity={0.7} />
            <g transform={`translate(${x} ${y}) rotate(${node.tilt * (1 - gather)}) scale(${1 - gather * 0.6})`}>
              <rect x={-94} y={-76} width={188} height={152} rx={24} fill={C.surface} stroke={node.color} strokeWidth={2} />
              <g transform="translate(0 -19)"><ToolGlyph kind={i} color={node.color} /></g>
              <text x={0} y={49} textAnchor="middle" fill={C.ink} fontSize={28} fontWeight={700}>{node.label}</text>
            </g>
          </g>;
        })}
        <g opacity={plate} transform={`translate(475 839) scale(${0.76 + plate * 0.24 + pulse * 0.012})`}>
          <rect x={-367} y={-165} width={734} height={330} rx={34} fill={C.blue} opacity={0.3 + pulse * 0.3} filter={`url(#s1-glow-${idx})`} />
          <rect x={-367} y={-165} width={734} height={330} rx={34} fill={`url(#s1-panel-${idx})`} stroke={C.ice} strokeWidth={2} />
          <path d="M-335-125H-220M220 125H335" stroke={C.ice} strokeWidth={4} />
          <text x={0} y={-74} textAnchor="middle" fill={C.ice} fontFamily={FONT_MONO} fontSize={21} letterSpacing={6}>ONE CONNECTED WORKFLOW</text>
          <text x={0} y={23} textAnchor="middle" fill={`url(#s1-metal-${idx})`} fontSize={94} fontWeight={900} letterSpacing={4}>DSH VIDEO</text>
          <text x={0} y={106} textAnchor="middle" fill={C.ink} fontSize={69} fontWeight={900} letterSpacing={1}>WORKBENCH</text>
        </g>
        <g opacity={chain}>
          <path d="M170 1138H790" fill="none" stroke="#25456F" strokeWidth={3} />
          <path d="M170 1138H790" fill="none" stroke={C.cyan} strokeWidth={4} strokeDasharray="34 170" strokeDashoffset={-f * 7} />
          {nodes.map((node: { label: string; x: number; y: number; tilt: number; color: string }, i: number) => <g key={node.label} transform={`translate(${170 + i * 206} ${1138 + (1 - chain) * 32})`}>
            <circle r={29} fill={C.surface} stroke={node.color} strokeWidth={2} />
            <g transform="scale(0.5)"><ToolGlyph kind={i} color={node.color} /></g>
            <text y={66} textAnchor="middle" fill={C.ink} fontSize={26}>{node.label}</text>
          </g>)}
        </g>
      </g>
      {Array.from({ length: 30 }, (_value: unknown, i: number) => {
        const t = ((f * (0.006 + (i % 4) * 0.001) + i * 0.137) % 1);
        const angle = i * 2.39996;
        const radius = (1 - t) * 510;
        return <circle key={i} cx={475 + Math.cos(angle) * radius} cy={850 + Math.sin(angle) * radius * 0.8} r={i % 6 === 0 ? 3 : 1.6} fill={i % 5 === 0 ? C.gold : C.ice} opacity={Math.sin(t * Math.PI) * 0.8} />;
      })}
      <g opacity={reveal(f, 57, 14)}>
        <text x={82} y={1320} fill={C.ink} fontSize={35} fontWeight={750}>面向 DeepSeek Harness</text>
        <text x={82} y={1373} fill={C.ice} fontSize={28}>开源工作台<tspan fill="#53647D"> / </tspan>AI 双引擎全链路</text>
        <circle cx={852} cy={1310} r={8 + pulse * 3} fill={C.cyan} />
      </g>
    </svg>
  </AbsoluteFill>;
};

const Scene_scene_02: React.FC<CustomSceneProps> = ({ scene, idx }) => {
  const { f, p, pulse } = useMotion(scene);
  const asset: string | undefined = scene.publicAssetFiles?.[0];
  const opening = reveal(f, 0, 13);
  const detail = reveal(f, 36, 14);
  const finish = reveal(f, 72, 13);
  const agents: { name: string; n: string; x: number; y: number; start: number }[] = [
    { name: '策划导演', n: '01', x: 80, y: 414, start: 5 },
    { name: '素材剪辑', n: '02', x: 502, y: 414, start: 22 },
    { name: '配音混音', n: '03', x: 80, y: 1008, start: 40 },
    { name: '动效质检导出', n: '04', x: 502, y: 1008, start: 58 },
  ];
  return <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: FONT_SANS, overflow: 'hidden' }}>
    <svg width="100%" height="100%" viewBox="0 0 1080 1920" style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id={`s2-wash-${idx}`}><stop stopColor="#17459A" stopOpacity={0.44} /><stop offset="1" stopColor={C.bg} stopOpacity={0} /></radialGradient>
        <linearGradient id={`s2-line-${idx}`} x1="0" y1="0" x2="1" y2="0"><stop stopColor={C.blue} stopOpacity={0} /><stop offset="0.5" stopColor={C.ice} /><stop offset="1" stopColor={C.blue} stopOpacity={0} /></linearGradient>
        <clipPath id={`s2-waves-${idx}`}><rect x={80} y={1350} width={810} height={54} rx={8} /></clipPath>
      </defs>
      <ellipse cx={485 + p * 35} cy={765} rx={640} ry={670} fill={`url(#s2-wash-${idx})`} />
      {Array.from({ length: 9 }, (_value: unknown, i: number) => <path key={i} d={`M${90 + i * 103} 250V1410`} stroke={C.ice} opacity={0.045} />)}
      <text x={80} y={262} fill={C.ice} fontFamily={FONT_MONO} fontSize={22} letterSpacing={4}>04 AGENTS / ONE MISSION</text>
      <text x={76} y={349} fill={C.ink} fontSize={65} fontWeight={900}>四位智能体<tspan fill={C.ice}>，全程协同</tspan></text>
      <g opacity={opening}>
        <path d="M59 472V450H80M890 450H911V472M59 966V988H80M890 988H911V966" fill="none" stroke={C.ice} strokeWidth={3} />
        <path d="M60 729H30M911 729H938" stroke={C.blue} strokeWidth={3} opacity={0.5 + pulse * 0.5} />
      </g>
      {agents.map((agent: { name: string; n: string; x: number; y: number; start: number }, i: number) => {
        const active = reveal(f, agent.start, 9);
        return <g key={agent.n} opacity={0.35 + active * 0.65} transform={`translate(${agent.x} ${agent.y + (1 - active) * 8})`}>
          <circle cx={15} cy={0} r={14} fill={active > 0.3 ? C.blue : C.surface} stroke={C.ice} strokeWidth={1} />
          <text x={15} y={5} textAnchor="middle" fill={C.ink} fontFamily={FONT_MONO} fontSize={12}>{agent.n}</text>
          <text x={41} y={9} fill={C.ink} fontSize={27} fontWeight={700}>{agent.name}</text>
          <path d={`M42 21H${42 + 292 * active}`} stroke={i === 3 ? C.gold : C.blue} strokeWidth={2} />
          <circle cx={340} cy={0} r={4 + pulse * 2} fill={active > 0.7 ? C.cyan : '#31405B'} />
        </g>;
      })}
      <path d="M453 414H478M453 1008H478" stroke={C.ice} strokeWidth={2} />
      <path d="M470 407L478 414L470 421M470 1001L478 1008L470 1015" fill="none" stroke={C.ice} strokeWidth={2} />
      <g opacity={detail}>
        <path d="M110 1048V1071H545" fill="none" stroke={C.ice} strokeWidth={1.5} strokeDasharray="5 7" strokeDashoffset={-f * 2} />
        <text x={80} y={1097} fill={C.ice} fontFamily={FONT_MONO} fontSize={19} letterSpacing={2}>LIVE AUDIO / 实时声轨</text>
      </g>
      <g opacity={finish} transform={`translate(0 ${(1 - finish) * 35})`}>
        <text x={585} y={1168} fill={C.ice} fontFamily={FONT_MONO} fontSize={20} letterSpacing={2}>DELIVERY READY</text>
        <text x={578} y={1244} fill={C.ink} fontFamily={FONT_MONO} fontSize={73} fontWeight={900}>1080<tspan fontSize={39} fill={C.ice}>P</tspan></text>
        <path d={`M585 1265H${585 + finish * 289}`} stroke={C.gold} strokeWidth={4} />
        <text x={583} y={1311} fill={C.ink} fontSize={34} fontWeight={800}>一键出片<tspan fill={C.gold}> ↗</tspan></text>
      </g>
      <g clipPath={`url(#s2-waves-${idx})`} opacity={detail * 0.45}>
        {Array.from({ length: 70 }, (_value: unknown, i: number) => {
          const height = 6 + Math.abs(Math.sin(i * 0.73 + f * 0.18) * Math.cos(i * 0.21 - f * 0.07)) * 37;
          return <rect key={i} x={82 + i * 11.5} y={1377 - height / 2} width={4} height={height} rx={2} fill={i % 7 === 0 ? C.gold : C.ice} />;
        })}
      </g>
      <path d={`M80 ${1440 - ((f * 2) % 1020)}H890`} stroke={`url(#s2-line-${idx})`} opacity={0.12} />
    </svg>
    <div style={{ position: 'absolute', left: 80, top: 466 + (1 - opening) * 30, width: 810, height: 510, opacity: opening, transform: `perspective(1800px) rotateX(${(1 - opening) * 5}deg)`, transformOrigin: '50% 50%' }}>
      <AppWindow title={scene.title} kicker="DSH WORKBENCH" style={{ width: '100%', height: 510 }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, background: '#080B12', overflow: 'hidden' }}>
          {asset ? <Img src={staticFile(asset)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
        </div>
      </AppWindow>
    </div>
    {asset ? <div style={{ position: 'absolute', left: 80, top: 1118 + (1 - detail) * 18, width: 465, height: 205, opacity: detail, border: '1px solid #416AAB', borderRadius: 16, overflow: 'hidden', background: C.surface, boxShadow: `0 0 ${18 + pulse * 10}px rgba(47,123,255,0.16)` }}>
      <FocusShot src={asset} cams={[{ t: 0, fx: 0.5, fy: 0.82, z: 2 }, { t: 1, fx: 0.54, fy: 0.82, z: 2.12 }]} marks={scene.marks} />
    </div> : null}
  </AbsoluteFill>;
};

type ToolNode = { n: number; group: number; angle: number; x: number; y: number };
type ToolGroup = { label: string; color: string; angle: number; x: number; y: number; start: number; count: number };

const Scene_scene_03: React.FC<CustomSceneProps> = ({ scene, idx }) => {
  const { f, p, pulse } = useMotion(scene);
  const cx = 478;
  const cy = 862;
  const counts: number[] = [5, 5, 5, 4, 4];
  const labels: string[] = ['策划', '素材', '声音', '渲染', '质检'];
  const colors: string[] = [C.ice, C.cyan, '#A5B4FC', C.blue, C.gold];
  let offset = 0;
  const groups: ToolGroup[] = counts.map((count: number, i: number) => {
    const start = offset;
    offset += count;
    const angle = -Math.PI / 2 + ((start + (count - 1) / 2) / 23) * Math.PI * 2;
    return { label: labels[i], color: colors[i], angle, x: cx + Math.cos(angle) * 202, y: cy + Math.sin(angle) * 186, start, count };
  });
  const nodes: ToolNode[] = Array.from({ length: 23 }, (_value: unknown, i: number) => {
    const angle = -Math.PI / 2 + i / 23 * Math.PI * 2;
    const group = i < 5 ? 0 : i < 10 ? 1 : i < 15 ? 2 : i < 19 ? 3 : 4;
    return { n: i + 1, group, angle, x: cx + Math.cos(angle) * 355, y: cy + Math.sin(angle) * 327 };
  });
  const litCount = Math.min(23, Math.max(0, Math.floor(interpolate(f, [5, 70], [0, 23], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))));
  const preset = reveal(f, 59, 28);
  const lock = reveal(f, 84, 14);
  const camera = 1.025 - p * 0.025 + pulse * 0.003;
  return <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: FONT_SANS, overflow: 'hidden' }}>
    <svg width="100%" height="100%" viewBox="0 0 1080 1920" style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id={`s3-core-${idx}`}><stop stopColor={C.blue} stopOpacity={0.4} /><stop offset="1" stopColor={C.bg} stopOpacity={0} /></radialGradient>
        <linearGradient id={`s3-chip-${idx}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#193666" /><stop offset="1" stopColor="#0A111E" /></linearGradient>
        <filter id={`s3-flare-${idx}`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <ellipse cx={cx} cy={cy} rx={580} ry={620} fill={`url(#s3-core-${idx})`} />
      {Array.from({ length: 38 }, (_value: unknown, i: number) => {
        const x = 65 + ((i * 139.7 + f * (0.19 + i % 3 * 0.08)) % 833);
        const y = 470 + ((i * 89.3 - f * 0.65 + 1500) % 900);
        return <path key={i} d={`M${x - 3} ${y}H${x + 3}M${x} ${y - 3}V${y + 3}`} stroke={C.ice} opacity={0.07 + (Math.sin(f * 0.04 + i) + 1) * 0.05} />;
      })}
      <text x={80} y={263} fill={C.ice} fontFamily={FONT_MONO} fontSize={21} letterSpacing={4}>CORDIS / PRODUCTION NETWORK</text>
      <text x={76} y={352} fill={C.ink} fontSize={66} fontWeight={900}><tspan fill={C.ice}>23</tspan> 个工具，一条完整链路</text>
      <text x={80} y={410} fill={C.muted} fontSize={28}>从策划到质检，连成视频制作网络</text>
      <text x={80} y={487} fill={C.ice} fontFamily={FONT_MONO} fontSize={20} letterSpacing={2}>TOOLS ONLINE</text>
      <text x={886} y={487} textAnchor="end" fill={litCount === 23 ? C.gold : C.ink} fontFamily={FONT_MONO} fontSize={37} fontWeight={800}>{String(litCount).padStart(2, '0')}<tspan fill="#42516B" fontSize={24}> / 23</tspan></text>
      <g transform={`translate(${cx} ${cy}) scale(${camera}) translate(${-cx} ${-cy})`}>
        <ellipse cx={cx} cy={cy} rx={355} ry={327} fill="none" stroke="#1D3559" strokeWidth={1.5} strokeDasharray="3 10" strokeDashoffset={-f * 0.6} />
        <ellipse cx={cx} cy={cy} rx={285} ry={260} fill="none" stroke={C.blue} strokeWidth={1} opacity={0.27} />
        <g transform={`rotate(${p * 36} ${cx} ${cy})`} opacity={0.4}>
          <path d={`M${cx - 304} ${cy - 84}A315 285 0 0 1 ${cx + 121} ${cy - 265}`} fill="none" stroke={C.ice} strokeWidth={3} />
          <path d={`M${cx + 304} ${cy + 84}A315 285 0 0 1 ${cx - 121} ${cy + 265}`} fill="none" stroke={C.blue} strokeWidth={3} />
        </g>
        {groups.map((group: ToolGroup, i: number) => {
          const on = reveal(f, 5 + group.start * 2.8, 10);
          return <g key={group.label}>
            <path d={`M${cx} ${cy}L${group.x} ${group.y}`} fill="none" stroke={group.color} strokeWidth={2} opacity={0.15 + on * 0.45} />
            <path d={`M${cx} ${cy}L${group.x} ${group.y}`} fill="none" stroke={group.color} strokeWidth={4} strokeDasharray="20 180" strokeDashoffset={-f * 6 - i * 31} opacity={on} />
          </g>;
        })}
        {nodes.map((node: ToolNode) => {
          const group = groups[node.group];
          const on = reveal(f, 5 + (node.n - 1) * 2.8, 9);
          const breathe = Math.sin(f * 0.06 + node.n * 0.7) * 2;
          const x = node.x + Math.cos(node.angle) * breathe;
          const y = node.y + Math.sin(node.angle) * breathe;
          const travel = ((f * 0.022 + node.n * 0.119) % 1);
          return <g key={node.n}>
            <path d={`M${group.x} ${group.y}L${x} ${y}`} stroke={group.color} strokeWidth={1.5} opacity={0.1 + on * 0.5} />
            <circle cx={lerp(group.x, x, travel)} cy={lerp(group.y, y, travel)} r={2.8} fill={group.color} opacity={on * Math.sin(travel * Math.PI)} />
            <circle cx={x} cy={y} r={24 + pulse * 4} fill={group.color} opacity={on * 0.1} />
            <circle cx={x} cy={y} r={20} fill={on > 0.5 ? '#132641' : '#0A101B'} stroke={on > 0.1 ? group.color : '#334155'} strokeWidth={1.6 + on} />
            <text x={x} y={y + 5} textAnchor="middle" fill={on > 0.4 ? C.ink : '#64748B'} fontFamily={FONT_MONO} fontSize={13} fontWeight={700}>{String(node.n).padStart(2, '0')}</text>
          </g>;
        })}
        {groups.map((group: ToolGroup) => {
          const on = reveal(f, 5 + group.start * 2.8, 12);
          return <g key={group.label} opacity={0.4 + on * 0.6}>
            <circle cx={group.x} cy={group.y} r={33} fill="#0A1322" stroke={group.color} strokeWidth={2} />
            <text x={group.x} y={group.y + 5} textAnchor="middle" fill={group.color} fontFamily={FONT_MONO} fontSize={20} fontWeight={800}>{group.count}</text>
            <rect x={group.x - 41} y={group.y + 37} width={82} height={32} rx={8} fill={C.bg} />
            <text x={group.x} y={group.y + 61} textAnchor="middle" fill={C.ink} fontSize={24} fontWeight={700}>{group.label}</text>
          </g>;
        })}
        <g transform={`translate(${cx} ${cy})`}>
          <rect x={-164} y={-74} width={328} height={148} rx={22} fill={C.blue} opacity={0.15 + pulse * 0.22} filter={`url(#s3-flare-${idx})`} />
          <rect x={-164} y={-74} width={328} height={148} rx={22} fill={`url(#s3-chip-${idx})`} stroke={C.ice} strokeWidth={2} />
          <path d="M-142-52H-101M101 52H142" stroke={C.ice} strokeWidth={3} />
          <text x={0} y={-13} textAnchor="middle" fill={C.ink} fontSize={32} fontWeight={900}>DeepSeek Harness</text>
          <text x={0} y={31} textAnchor="middle" fill={C.ice} fontFamily={FONT_MONO} fontSize={21} letterSpacing={4}>CORDIS CORE</text>
          {Array.from({ length: 7 }, (_value: unknown, i: number) => <g key={i} stroke={C.ice} opacity={0.45} strokeWidth={2}><path d={`M${-115 + i * 38} -74V-87M${-115 + i * 38} 74V87`} /></g>)}
        </g>
        <g opacity={reveal(f, 56, 10)} transform={`translate(${lerp(256, cx, preset)} ${lerp(1272, 1015, preset)}) rotate(${lerp(-8, 0, preset)})`}>
          <rect x={-131} y={-37} width={262} height={74} rx={13} fill="#132744" stroke={lock > 0.4 ? C.gold : C.ice} strokeWidth={2} />
          <path d="M-111-16V16M-103-16V16M-95-16V16" stroke={C.ice} strokeWidth={2} />
          <text x={18} y={8} textAnchor="middle" fill={C.ink} fontFamily={FONT_MONO} fontSize={28} fontWeight={800}>VIDEO PRESET</text>
          <circle cx={113} cy={0} r={4} fill={lock > 0.4 ? C.gold : C.cyan} />
        </g>
        <path d={`M${cx} 978V936`} stroke={C.gold} strokeWidth={3} strokeDasharray="6 7" strokeDashoffset={-f * 3} opacity={preset} />
        {[0, 1].map((i: number) => {
          const t = ((f - 76 + i * 19) % 38 + 38) % 38 / 38;
          return <ellipse key={i} cx={cx} cy={cy} rx={180 + t * 220} ry={120 + t * 250} fill="none" stroke={C.gold} strokeWidth={1.6} opacity={lock * (1 - t) * 0.5} />;
        })}
      </g>
      <g opacity={reveal(f, 76, 16)} transform={`translate(0 ${(1 - reveal(f, 76, 16)) * 16})`}>
        <path d="M80 1262H890" stroke="#263C5B" strokeWidth={1} />
        <text x={80} y={1323} fill={C.ink} fontSize={37} fontWeight={800}>视频制作模式 <tspan fill={C.gold} fontFamily={FONT_MONO}>Preset</tspan></text>
        <text x={80} y={1375} fill={C.muted} fontSize={27}>23 个 Cordis 工具插件，完整串联制作链路</text>
      </g>
    </svg>
  </AbsoluteFill>;
};

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_01_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-01': Scene_scene_01,
  'scene-02': Scene_scene_02,
  'scene-03': Scene_scene_03
};
