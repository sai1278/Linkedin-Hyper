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

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
})

type RegisterFormValues = z.infer<typeof registerSchema>

export default function RegisterPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' }
  })

  const onSubmit = (data: RegisterFormValues) => {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            email: data.email,
            password: data.password
          })
        })

        if (!res.ok) {
          const resultData = await res.json()
          if (res.status === 409) {
            setError('Email already registered')
          } else {
            setError(resultData.error || 'Failed to register')
          }
          return
        }

        // Auto login
        const loginResult = await signIn('credentials', {
          email: data.email,
          password: data.password,
          redirect: false,
        })

        if (loginResult?.error) {
          setError('Registered successfully, but auto-login failed. Please sign in.')
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
          <h1 className="text-2xl font-bold text-slate-100">Create an Account</h1>
          <p className="text-slate-400 mt-2">Join LinkedIn Chat Tracker</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Input 
              {...register('name')}
              type="text" 
              placeholder="Your Name" 
              className="bg-[#0F172A] border-slate-700 text-slate-200"
            />
            {errors.name && (
              <p className="text-red-400 text-sm mt-1">{errors.name.message}</p>
            )}
          </div>

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
              placeholder="Password (min 8 chars)" 
              className="bg-[#0F172A] border-slate-700 text-slate-200"
            />
            {errors.password && (
              <p className="text-red-400 text-sm mt-1">{errors.password.message}</p>
            )}
          </div>

          <div>
            <Input 
              {...register('confirmPassword')}
              type="password" 
              placeholder="Confirm Password" 
              className="bg-[#0F172A] border-slate-700 text-slate-200"
            />
            {errors.confirmPassword && (
              <p className="text-red-400 text-sm mt-1">{errors.confirmPassword.message}</p>
            )}
          </div>

          <Button 
            type="submit" 
            className="w-full bg-sky-500 hover:bg-sky-600 text-white"
            disabled={isPending}
          >
            {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Register
          </Button>
        </form>

        {error && (
          <Alert variant="destructive" className="mt-4 bg-red-900/50 border-red-900 text-red-200">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link href="/login" className="text-sky-400 hover:text-sky-300 font-medium">
            Sign in here
          </Link>
        </div>
      </div>
    </div>
  )
}
