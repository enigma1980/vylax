'use client';
import { useEffect } from 'react';
import { useBreadcrumb } from '@/lib/breadcrumb';

interface Props {
  clientName: string | null;
  clientId:   string | null;
  hostname:   string;
}

export function BreadcrumbSetter({ clientName, clientId, hostname }: Props) {
  const { setCrumbs } = useBreadcrumb();
  useEffect(() => {
    const crumbs = [
      { label: 'Clientes', href: '/clientes' },
      ...(clientName && clientId ? [{ label: clientName, href: `/clientes/${clientId}` }] : []),
      { label: hostname },
    ];
    setCrumbs(crumbs);
    return () => setCrumbs([]);
  }, [clientName, clientId, hostname, setCrumbs]);
  return null;
}
