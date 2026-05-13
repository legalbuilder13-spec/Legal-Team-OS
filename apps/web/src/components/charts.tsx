'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTheme } from './theme';

interface ActivityPoint {
  day: string;
  opened: number;
  closed: number;
  breached: number;
}

export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  const { resolved } = useTheme();
  const dark = resolved === 'dark';

  const grid = dark ? '#292524' : '#f5f5f4';
  const tick = dark ? '#a8a29e' : '#78716c';

  return (
    <div className="h-48 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gOpened" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gClosed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gBreached" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke={grid} vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(d) => {
              const dt = new Date(d);
              return `${dt.getMonth() + 1}/${dt.getDate()}`;
            }}
            tick={{ fontSize: 10, fill: tick }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: tick }}
            axisLine={false}
            tickLine={false}
            width={20}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: dark ? '1px solid #44403c' : '1px solid #e7e5e4',
              backgroundColor: dark ? '#1c1917' : '#ffffff',
              fontSize: 12,
              boxShadow: '0 4px 12px -4px rgba(0,0,0,0.1)',
            }}
            labelStyle={{ color: tick, fontSize: 11 }}
            labelFormatter={(d) => new Date(d).toLocaleDateString()}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: tick }}
            iconType="circle"
            iconSize={8}
          />
          <Area
            type="monotone"
            dataKey="opened"
            stroke="#8b5cf6"
            strokeWidth={2}
            fill="url(#gOpened)"
            name="Opened"
          />
          <Area
            type="monotone"
            dataKey="closed"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#gClosed)"
            name="Closed"
          />
          <Area
            type="monotone"
            dataKey="breached"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#gBreached)"
            name="Breached"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface BreakdownDatum {
  label: string;
  value: number;
}

export function StatusBreakdownChart({ data }: { data: BreakdownDatum[] }) {
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  const tick = dark ? '#a8a29e' : '#78716c';

  return (
    <div className="h-36">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            dataKey="label"
            type="category"
            tick={{ fontSize: 11, fill: tick }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip
            cursor={{ fill: dark ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.06)' }}
            contentStyle={{
              borderRadius: 10,
              border: dark ? '1px solid #44403c' : '1px solid #e7e5e4',
              backgroundColor: dark ? '#1c1917' : '#ffffff',
              fontSize: 12,
            }}
          />
          <Bar dataKey="value" fill="#8b5cf6" radius={[0, 6, 6, 0]} barSize={12} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
