import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://strategyforge.vercel.app'

  return [
    { url: `${baseUrl}`, lastModified: new Date(), changeFrequency: 'weekly' as const, priority: 1 },
    { url: `${baseUrl}/analysis`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.8 },
    { url: `${baseUrl}/diary`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.8 }
  ]
}
