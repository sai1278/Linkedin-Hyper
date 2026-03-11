'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MessageSquare, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' }
  })

  const onSubmit = (data: LoginFormValues) => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await signIn('credentials', {
          email: data.email,
          password: data.password,
          redirect: false,
        })

        if (result?.error) {
          setError('Invalid email or password.')
          return
        }

        router.push('/dashboard')
        router.refresh()
      } catch (err) {
        setError('An unexpected error occurred.')
      }
    })
  }

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
      <div className="bg-[#1E293B] rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-sky-500/10 p-3 rounded-full mb-4">
            <MessageSquare className="w-8 h-8 text-sky-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">LinkedIn Chat Tracker</h1>
          <p className="text-slate-400 mt-2">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Input 
              {...register('email')}
              type="email" 
              placeholder="name@example.com" 
              className="bg-[#0F172A] border-slate-700 text-slate-200"
            />
            {errors.email && (
              <p className="text-red-400 text-sm mt-1">{errors.email.message}</p>
            )}
          </div>

          <div>
            <Input 
              {...register('password')}
              type="password" 
              placeholder="••••••••" 
              className="bg-[#0F172A] border-slate-700 text-slate-200"
            />
            {errors.password && (
              <p className="text-red-400 text-sm mt-1">{errors.password.message}</p>
            )}
          </div>

          <Button 
            type="submit" 
            className="w-full bg-sky-500 hover:bg-sky-600 text-white"
            disabled={isPending}
          >
            {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Sign In
          </Button>
        </form>

        {error && (
          <Alert variant="destructive" className="mt-4 bg-red-900/50 border-red-900 text-red-200">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="mt-6 text-center text-sm text-slate-400">
          Don't have an account?{' '}
          <Link href="/register" className="text-sky-400 hover:text-sky-300 font-medium">
            Register here
          </Link>
        </div>
      </div>
    </div>
  )
}
