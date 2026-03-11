import { Check, X } from 'lucide-react'

interface TopContact {
  contactId: string
  name: string
  avatarUrl: string | null
  messageCount: number
  replied: boolean
}

interface TopContactsTableProps {
  contacts: TopContact[]
}

export function TopContactsTable({ contacts }: TopContactsTableProps) {
  if (!contacts || contacts.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
        No contact data available.
      </div>
    )
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="bg-[#0F172A] text-slate-400 border-b border-[#334155]">
          <tr>
            <th className="px-4 py-3 font-medium">Contact</th>
            <th className="px-4 py-3 font-medium text-center">Messages</th>
            <th className="px-4 py-3 font-medium text-center">Engagement</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#334155]">
          {contacts.map((contact) => (
            <tr key={contact.contactId} className="hover:bg-[#0F172A] transition-colors">
              
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-sky-900 flex items-center justify-center shrink-0">
                    {contact.avatarUrl ? (
                      <img src={contact.avatarUrl} alt={contact.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sky-300 font-semibold text-xs">{contact.name[0]?.toUpperCase() || '?'}</span>
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-slate-200">{contact.name}</div>
                  </div>
                </div>
              </td>
              
              <td className="px-4 py-3 text-center">
                <span className="inline-flex items-center justify-center bg-[#0F172A] border border-[#334155] rounded-full px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                  {contact.messageCount}
                </span>
              </td>
              
              <td className="px-4 py-3 text-center">
                {contact.replied ? (
                  <span className="inline-flex items-center justify-center gap-1 bg-emerald-500/10 text-emerald-400 rounded-md px-2 py-1 text-xs font-medium border border-emerald-500/20">
                    <Check className="w-3 h-3" /> Replied
                  </span>
                ) : (
                  <span className="inline-flex items-center justify-center gap-1 bg-[#0F172A] text-slate-500 rounded-md px-2 py-1 text-xs font-medium border border-[#334155]">
                    <X className="w-3 h-3" /> No reply
                  </span>
                )}
              </td>

            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
