import { useMemo } from 'react'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'
import { format, parseISO } from 'date-fns'

interface ActivityChartProps {
  data: Array<{ date: string, messagesSent: number, connectionsSent: number, replies: number }>
  period: string
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const formattedDate = format(parseISO(label), 'MMM d, yyyy')
    return (
      <div className="bg-[#1E293B] border border-[#334155] rounded-xl shadow-xl px-4 py-3 min-w-[180px]">
        <p className="text-slate-300 font-semibold mb-3 text-sm">{formattedDate}</p>
        <div className="space-y-2">
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex justify-between items-center text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-slate-400">{entry.name}</span>
              </div>
              <span className="font-semibold text-slate-100">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return null
}

const renderLegend = (props: any) => {
  const { payload } = props
  
  return (
    <ul className="flex justify-center gap-6 mt-4">
      {payload.map((entry: any, index: number) => (
        <li key={`item-${index}`} className="flex items-center gap-2 text-sm text-slate-400">
          <div 
            className={`w-3 h-3 ${entry.type === 'line' ? 'rounded-full' : 'rounded-sm'}`} 
            style={{ backgroundColor: entry.color }} 
          />
          {entry.value}
        </li>
      ))}
    </ul>
  )
}

export function ActivityChart({ data, period }: ActivityChartProps) {
  // Format dates for X-Axis
  const formattedData = useMemo(() => {
    return data.map(item => ({
      ...item,
      displayDate: format(parseISO(item.date), 'MMM d')
    })).reverse() // Reverse to show oldest left to newest right assuming data is newest first (based on the way map was populated in loop)
  }, [data])

  if (!data || data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-slate-500">
        No activity data available for this period.
      </div>
    )
  }

  return (
    <div className="w-full h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={formattedData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
          <XAxis 
            dataKey="date" 
            tickFormatter={(value) => format(parseISO(value), 'MMM d')}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748B', fontSize: 12 }}
            dy={10}
            minTickGap={20}
          />
          <YAxis hide />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#334155', opacity: 0.2 }} />
          <Legend content={renderLegend} />
          <Bar 
            dataKey="messagesSent" 
            name="Messages Sent" 
            fill="#0EA5E9" 
            radius={[4, 4, 0, 0]} 
            barSize={20}
            isAnimationActive={false}
          />
          <Bar 
            dataKey="connectionsSent" 
            name="Connections Sent" 
            fill="#8B5CF6" 
            radius={[4, 4, 0, 0]} 
            barSize={20}
            isAnimationActive={false}
          />
          <Line 
            type="monotone" 
            dataKey="replies" 
            name="Replies" 
            stroke="#10B981" 
            strokeWidth={3} 
            dot={false}
            activeDot={{ r: 6, fill: '#10B981', stroke: '#1E293B', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
