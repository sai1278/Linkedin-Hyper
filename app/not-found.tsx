import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center">
      <Container>
        <div className="max-w-2xl mx-auto text-center py-16 px-4 sm:py-24 sm:px-6 lg:px-8">
          <p className="text-base font-semibold text-[#49648C] tracking-wide uppercase">
            404 Error
          </p>
          <h1 className="mt-2 text-4xl font-extrabold text-[#0B1F3B] tracking-tight sm:text-5xl">
            Page Not Found
          </h1>
          <p className="mt-4 text-base text-gray-500 mb-8">
            Sorry, we couldn&apos;t find the page you&apos;re looking for. It might have been moved or doesn&apos;t exist.
          </p>
          <div className="mt-6">
            <Link href="/" passHref>
              <Button variant="primary" size="lg" className="inline-flex items-center">
                Return Home
              </Button>
            </Link>
          </div>
        </div>
      </Container>
    </main>
  );
}
