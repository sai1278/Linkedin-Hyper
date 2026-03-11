import { Skeleton } from '@/components/ui/skeleton'

export default function AnalyticsLoading() {
  return (
    <div className="max-w-7xl mx-auto pb-12 space-y-8 animate-in fade-in">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48 bg-[#1E293B] border border-[#334155] rounded-xl" />
          <Skeleton className="h-4 w-64 bg-[#1E293B] border border-[#334155] rounded-xl" />
        </div>
        <Skeleton className="h-10 w-32 bg-[#1E293B] border border-[#334155] rounded-xl" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-[#1E293B] border border-[#334155] rounded-2xl p-5">
            <Skeleton className="h-5 w-24 mb-4 opacity-20" />
            <Skeleton className="h-8 w-16 opacity-30" />
            <Skeleton className="h-4 w-32 mt-2 opacity-10" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-[#1E293B] border border-[#334155] rounded-2xl p-6 h-[400px]">
          <Skeleton className="h-6 w-48 mb-6 opacity-20" />
          <Skeleton className="h-[300px] w-full opacity-10 rounded-xl" />
        </div>
        <div className="bg-[#1E293B] border border-[#334155] rounded-2xl p-6 h-[400px]">
          <Skeleton className="h-6 w-32 mb-6 opacity-20" />
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="w-8 h-8 rounded-full shrink-0 opacity-20" />
                <div className="flex-1 space-y-2 py-1">
                  <Skeleton className="h-4 w-full opacity-20" />
                  <Skeleton className="h-3 w-1/2 opacity-10" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
