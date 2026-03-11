import { Skeleton } from '@/components/ui/skeleton'

export default function DashboardLoading() {
  return (
    <div className="max-w-7xl mx-auto pb-12 space-y-8 animate-in fade-in">
      
      <div>
        <Skeleton className="h-8 w-64 bg-[#1E293B] rounded-xl mb-2" />
        <Skeleton className="h-4 w-96 bg-[#1F2937] rounded-xl" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-[#1E293B] border border-[#334155] rounded-2xl p-6">
             <div className="flex gap-4 items-center">
               <Skeleton className="w-12 h-12 rounded-xl opacity-20 shrink-0" />
               <div className="space-y-2 flex-1">
                 <Skeleton className="h-4 w-full opacity-20" />
                 <Skeleton className="h-6 w-1/2 opacity-30" />
               </div>
             </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className="bg-[#1E293B] border border-[#334155] rounded-2xl p-6 h-[400px] flex flex-col">
            <Skeleton className="h-6 w-32 mb-6 opacity-20" />
            <div className="flex-1 space-y-6 overflow-hidden">
               {[1, 2, 3, 4, 5].map((j) => (
                 <div key={j} className="flex gap-4">
                   <Skeleton className="w-10 h-10 rounded-full opacity-20 shrink-0" />
                   <div className="flex-1 space-y-2 py-1">
                     <Skeleton className="h-4 w-1/2 opacity-20" />
                     <Skeleton className="h-3 w-3/4 opacity-10" />
                   </div>
                 </div>
               ))}
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-32 bg-[#1E293B] rounded-xl" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 bg-[#1E293B] border border-[#334155] rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  )
}
