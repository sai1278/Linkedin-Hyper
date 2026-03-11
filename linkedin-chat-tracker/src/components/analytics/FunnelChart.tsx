interface FunnelChartProps {
  sent: number
  replied: number
  accepted: number
}

export function FunnelChart({ sent, replied, accepted }: FunnelChartProps) {
  const hasData = sent > 0
  
  const widthReplied = hasData ? (replied / sent) * 100 : 0
  const widthAccepted = hasData ? (accepted / sent) * 100 : 0

  return (
    <div className="flex flex-col w-full px-2">
      <div className="space-y-6 mt-4">
        
        {/* Reached Out */}
        <div className="relative">
          <div className="flex justify-between items-end mb-1 px-1 text-sm font-medium">
            <span className="text-slate-300">Reached Out</span>
            <span className="text-sky-400">{sent}</span>
          </div>
          <div className="w-full h-10 bg-[#0F172A] rounded-full overflow-hidden border border-[#334155]">
            <div 
              className="h-full bg-sky-500 rounded-full transition-all duration-700 ease-in-out flex items-center"
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Got Reply */}
        <div className="relative">
          <div className="flex justify-between items-end mb-1 px-1 text-sm font-medium">
            <span className="text-slate-300">Got Reply</span>
            <span className="text-violet-400">{replied} <span className="opacity-60 font-normal ml-1">({widthReplied.toFixed(1)}%)</span></span>
          </div>
          <div className="w-full h-10 bg-[#0F172A] rounded-full overflow-hidden border border-[#334155]">
            <div 
              className="h-full bg-violet-500 rounded-full transition-all duration-700 ease-in-out"
              style={{ width: `${Math.max(widthReplied, 2)}%` }} // 2% min width to be visible if > 0
            />
          </div>
        </div>

        {/* Connected */}
        <div className="relative">
          <div className="flex justify-between items-end mb-1 px-1 text-sm font-medium">
            <span className="text-slate-300">Connected</span>
            <span className="text-emerald-400">{accepted} <span className="opacity-60 font-normal ml-1">({widthAccepted.toFixed(1)}%)</span></span>
          </div>
          <div className="w-full h-10 bg-[#0F172A] rounded-full overflow-hidden border border-[#334155]">
            <div 
              className="h-full bg-emerald-500 rounded-full transition-all duration-700 ease-in-out"
              style={{ width: `${Math.max(widthAccepted, 2)}%` }}
            />
          </div>
        </div>

      </div>
    </div>
  )
}
