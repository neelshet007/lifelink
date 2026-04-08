import { Suspense } from 'react';
import MockGovernmentGatewayClient from '../../../components/MockGovernmentGatewayClient';

export default function MockGovernmentGatewayPage() {
  return (
    <Suspense fallback={null}>
      <MockGovernmentGatewayClient />
    </Suspense>
  );
}
