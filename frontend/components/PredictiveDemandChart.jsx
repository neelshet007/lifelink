'use client';

const data = [18, 20, 21, 24, 26, 27, 35, 48, 56, 72, 88, 97];

export default function PredictiveDemandChart() {
  const width = 560;
  const height = 220;
  const padding = 24;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const stepX = (width - padding * 2) / (data.length - 1);

  const points = data.map((value, index) => {
    const x = padding + index * stepX;
    const normalized = (value - min) / (max - min || 1);
    const y = height - padding - normalized * (height - padding * 2);
    return [x, y];
  });

  const linePath = points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');

  const areaPath = `${linePath} L ${points.at(-1)[0]} ${height - padding} L ${points[0][0]} ${height - padding} Z`;

  return (
    <div className="rounded-[1.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5">
      <div className="mb-4 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
        <span>Next 24 Hours</span>
        <span>Predicted Dengue Outbreak</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
        <defs>
          <linearGradient id="demandArea" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,143,31,0.42)" />
            <stop offset="100%" stopColor="rgba(11,78,162,0.02)" />
          </linearGradient>
        </defs>

        {[0, 1, 2, 3].map((row) => {
          const y = padding + ((height - padding * 2) / 3) * row;
          return <line key={row} x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 8" />;
        })}

        <path d={areaPath} fill="url(#demandArea)" />
        <path d={linePath} fill="none" stroke="#ff8f1f" strokeWidth="4" strokeLinecap="round" />

        {points.map(([x, y], index) => (
          <g key={index}>
            <circle cx={x} cy={y} r="6" fill="#08111d" stroke="#8bc0ff" strokeWidth="3" />
            {index === points.length - 1 && (
              <circle cx={x} cy={y} r="12" fill="none" stroke="rgba(255,143,31,0.45)" strokeWidth="2" />
            )}
          </g>
        ))}
      </svg>
      <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-slate-400">Current O-ve load</p>
          <p className="mt-1 font-semibold text-white">26 units / hour</p>
        </div>
        <div>
          <p className="text-slate-400">Predicted peak</p>
          <p className="mt-1 font-semibold text-[#ffbf73]">97 units / hour</p>
        </div>
        <div>
          <p className="text-slate-400">Trigger reason</p>
          <p className="mt-1 font-semibold text-white">Dengue cluster anomaly</p>
        </div>
        <div>
          <p className="text-slate-400">Action window</p>
          <p className="mt-1 font-semibold text-emerald-300">Within 24 hours</p>
        </div>
      </div>
    </div>
  );
}
