import { Suspense } from 'react';
import MockAbdmGatewayClient from '../../components/MockAbdmGatewayClient';

export default function MockAbdmPage() {
  return (
    <Suspense fallback={null}>
      <MockAbdmGatewayClient />
    </Suspense>
  );
}
