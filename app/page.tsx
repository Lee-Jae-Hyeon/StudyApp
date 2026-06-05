'use client';
import dynamic from 'next/dynamic';

const StudyApp = dynamic(() => import('@/app/components/study/StudyApp'), { ssr: false });

export default function Home() {
  return <StudyApp />;
}
