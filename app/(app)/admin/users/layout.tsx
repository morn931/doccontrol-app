import { redirect } from 'next/navigation'
import { getDeveloperSession } from '@/lib/developer-access'

export default async function UsersAccessLayout({ children }: { children: React.ReactNode }) {
  const session = await getDeveloperSession()
  if (!session) redirect('/dashboard')

  return children
}

