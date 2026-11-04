import { notFound } from 'next/navigation';
import { reviewAvailable } from '@/server/football/review-access';
import ReviewWorkbench from './review-workbench';

export const metadata = { title:'Futbol veri incelemesi', robots:{ index:false,follow:false } };
export default async function ReviewPage() {
  if (!reviewAvailable(process.env.NODE_ENV,process.env.DATABASE_ADMIN_URL) ||
      !process.env.GOLVIA_REVIEW_TOKEN || process.env.GOLVIA_REVIEW_TOKEN.length < 32) notFound();
  return <ReviewWorkbench />;
}
