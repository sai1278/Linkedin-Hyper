export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center">
        {/* Customized spinner using brand color #49648C */}
        <div className="w-16 h-16 border-4 border-gray-200 border-t-[#49648C] rounded-full animate-spin"></div>
        <p className="mt-4 text-[#49648C] font-medium text-lg animate-pulse">Loading...</p>
      </div>
    </div>
  );
}
