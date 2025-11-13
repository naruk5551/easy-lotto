'use client';
import Link from 'next/link';

export default function BackHome() {
  return (
    <div className="mt-6 flex justify-center">
      <Link href="/home" className="rounded bg-gray-100 hover:bg-gray-200 px-4 py-2">
        กลับหน้า Home
      </Link>
    </div>
  );
}
