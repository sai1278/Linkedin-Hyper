import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatsCardProps {
  label: string
  value: string | number
  change?: number        // percentage change vs previous period
  changeLabel?: string   // e.g. "vs last 30 days"
  icon: LucideIcon
  color: 'sky' | 'violet' | 'emerald' | 'amber' | 'rose'
  loading?: boolean
}

export function StatsCard({ label, value, change, changeLabel, icon: Icon, color, loading }: StatsCardProps) {
  const colorStyles = {
    sky: 'bg-sky-500/20 text-sky-500 shadow-[inset_0_0_80px_rgba(14,165,233,0.1)]',
    violet: 'bg-violet-500/20 text-violet-500 shadow-[inset_0_0_80px_rgba(139,92,246,0.1)]',
    emerald: 'bg-emerald-500/20 text-emerald-500 shadow-[inset_0_0_80px_rgba(16,185,129,0.1)]',
    amber: 'bg-amber-500/20 text-amber-500 shadow-[inset_0_0_80px_rgba(245,158,11,0.1)]',
    rose: 'bg-rose-500/20 text-rose-500 shadow-[inset_0_0_80px_rgba(244,63,94,0.1)]',
  }

  const radialGlow = {
    sky: 'radial-gradient(circle at top right, rgba(14,165,233,0.15), transparent 70%)',
    violet: 'radial-gradient(circle at top right, rgba(139,92,246,0.15), transparent 70%)',
    emerald: 'radial-gradient(circle at top right, rgba(16,185,129,0.15), transparent 70%)',
    amber: 'radial-gradient(circle at top right, rgba(245,158,11,0.15), transparent 70%)',
    rose: 'radial-gradient(circle at top right, rgba(244,63,94,0.15), transparent 70%)',
  }

  if (loading) {
    return (
      <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6 animate-pulse">
        <div className="flex justify-between items-start mb-4">
          <div className="w-12 h-12 rounded-xl bg-slate-700" />
        </div>
        <div className="h-8 w-24 bg-slate-700 rounded mb-2" />
        <div className="h-4 w-32 bg-slate-700 rounded" />
      </div>
    )
  }

  return (
    <div 
      className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6 relative overflow-hidden flex flex-col justify-between transition-all hover:border-[#475569]"
      style={{ backgroundImage: radialGlow[color] }}
    >
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div className="flex flex-col gap-1">
           <h3 className="text-sm font-medium text-[#94A3B8]">{label}</h3>
           <p className="text-3xl font-bold text-[#F1F5F9]">{value}</p>
        </div>
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", colorStyles[color])}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      {change !== undefined && (
        <div className="flex items-center gap-2 mt-2 relative z-10">
          <div className={cn(
            "flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full",
            change >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
          )}>
            {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(change)}%
          </div>
          {changeLabel && <span className="text-xs text-[#94A3B8]">{changeLabel}</span>}
        </div>
      )}
    </div>
  )
}
