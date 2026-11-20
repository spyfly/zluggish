/** The server's TLS certificate, as GET /api/tls reports it. */
export type TlsStatus = {
  mode: 'managed' | 'legacy' | 'custom' | 'disabled';
  certificate: {
    fingerprint256: string;
    thumbprint: string;
    subject: string;
    notBefore: string;
    notAfter: string;
    hosts: Array<string>;
    /** Such as `ECDSA P-256`. */
    key: string;
  } | null;
  serverAddress: string;
  lifetimeYears: number;
};
