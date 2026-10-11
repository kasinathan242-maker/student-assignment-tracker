import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/** Daily submission counts. An equivalent data table is available via the card's "Show as table" toggle. */
export default function SubmissionsChart({ data }: { data: { date: string; count: number }[] }) {
  const total = data.reduce((t, d) => t + d.count, 0);
  return (
    <figure>
      <div className="h-64" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            accessibilityLayer={false}
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => v.slice(5)}
              tick={{ fill: 'var(--fg-muted)', fontSize: 12 }}
              interval="preserveStartEnd"
              minTickGap={18}
            />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--fg-muted)', fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--fg)',
              }}
              labelStyle={{ color: 'var(--fg)' }}
            />
            <Bar
              dataKey="count"
              name="Submissions"
              fill="var(--accent)"
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-sm text-fg-muted">
        {total} submission{total === 1 ? '' : 's'} in the last 30 days.
      </figcaption>
    </figure>
  );
}
