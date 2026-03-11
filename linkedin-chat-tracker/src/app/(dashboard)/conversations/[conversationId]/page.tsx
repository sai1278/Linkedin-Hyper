import { redirect } from 'next/navigation'

export default function ConversationRoutePage({
  params
}: {
  params: { conversationId: string }
}) {
  // This page just redirects to the main layout with the id in query string 
  // so the Client Component can manage the two panel layout smoothly without full re-renders
  redirect(`/conversations?id=${params.conversationId}`)
}
