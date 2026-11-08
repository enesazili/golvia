import type { Metadata } from 'next';
import { Friends } from '@/features/social/friends';
export const metadata:Metadata={title:'Arkadaşlar'};
export default function FriendsPage(){return <Friends/>;}
