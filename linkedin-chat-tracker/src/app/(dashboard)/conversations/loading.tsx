import { Skeleton } from '@/components/ui/skeleton'

export default function ConversationsLoading() {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] -m-6">
      
      {/* LEFT PANEL SKELETON */}
      <div className="w-full md:w-80 flex-none flex flex-col bg-[#1E293B] border-r border-[#334155]">
        {/* Search Bar Skeleton */}
        <div className="p-4 border-b border-[#334155] shrink-0">
          <Skeleton className="w-full h-9 rounded-lg opacity-20" />
        </div>
        
        {/* Tabs Skeleton */}
        <div className="flex border-b border-[#334155] shrink-0">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1 py-3 px-2 flex justify-center">
              <Skeleton className="w-12 h-4 rounded opacity-20" />
            </div>
          ))}
        </div>
        
        {/* List Skeleton */}
        <div className="flex-1 overflow-y-hidden divide-y divide-[#334155]">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="p-4 flex gap-3">
              <Skeleton className="w-12 h-12 rounded-full shrink-0 opacity-20" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-4 w-1/3 rounded opacity-20" />
                <Skeleton className="h-3 w-3/4 rounded opacity-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* RIGHT PANEL SKELETON */}
      <div className="flex-1 flex flex-col bg-[#0F172A] hidden md:flex min-w-0">
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
           <Skeleton className="w-20 h-20 rounded-full mb-6 opacity-10" />
           <Skeleton className="w-48 h-5 rounded opacity-10" />
        </div>
      </div>

    </div>
  )
}
