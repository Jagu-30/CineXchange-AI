'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMission, formatINR } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import type { ComplianceDocument, RiskBreakdown, ApprovalDecision } from '@/lib/types';
import {
  ShieldCheck,
  ShieldAlert,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Building,
  DollarSign,
  Upload,
  ArrowRight,
  FileCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function CompliancePageContent() {
  const router = useRouter();
  const {
    productionState,
    runCompliance,
    approveDecision,
    rejectDecision,
  } = useMission();

  const [loading, setLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<ComplianceDocument | null>(null);

  const docs: ComplianceDocument[] = productionState?.compliance || [
    {
      document_id: 'DOC-INS-001',
      document_type: 'INSURANCE',
      vendor_id: 'V003',
      vendor_name: 'ForestFrame Rentals',
      valid_from: '2026-08-01',
      valid_until: '2026-09-30',
      coverage_amount: 5000000,
      status: 'VALID',
      extraction_confidence: 0.98,
      extracted_fields: {
        insurer: 'New India Assurance Film Unit',
        policy_holder: 'ForestFrame Media Rigs Ltd',
        policy_type: 'On-Location All Risk Equipment & Third-Party Liability',
        coverage_limit_inr: 5000000,
        weather_delay_clause: true,
      },
      source_reference: 'data/mock_docs/insurance_v003_valid.pdf',
    },
    {
      document_id: 'DOC-PRM-001',
      document_type: 'PERMIT',
      vendor_id: 'V003',
      vendor_name: 'Karnataka Forest Dept.',
      valid_from: '2026-08-15',
      valid_until: '2026-08-30',
      coverage_amount: 0,
      status: 'VALID',
      extraction_confidence: 0.99,
      extracted_fields: {
        issuing_authority: 'Office of Deputy Conservator of Forests, Shivamogga',
        filming_range: 'Agumbe & Someshwara Wildlife Sanctuary Buffer',
        authorized_hours: '18:00 to 06:00 (Night Shoot Authorized)',
        ranger_escort_required: true,
      },
      source_reference: 'data/mock_docs/kfd_night_permit.pdf',
    },
    {
      document_id: 'DOC-LIC-001',
      document_type: 'LICENSE',
      vendor_id: 'V001',
      vendor_name: 'Skyline Aerials / LightForge',
      valid_from: '2024-01-10',
      valid_until: '2029-01-09',
      coverage_amount: 1000000,
      status: 'VALID',
      extraction_confidence: 0.97,
      extracted_fields: {
        pilot_name: 'Rohan Deshmukh',
        license_category: 'Small & Medium RPA (Night Flight Endorsement)',
        medical_validity: 'CURRENT',
      },
      source_reference: 'data/mock_docs/dgca_pilot_license.pdf',
    },
    {
      document_id: 'DOC-CTR-001',
      document_type: 'CONTRACT',
      vendor_id: 'V003',
      vendor_name: 'ForestFrame Rentals',
      valid_from: '2026-08-01',
      valid_until: '2026-12-31',
      coverage_amount: 2500000,
      status: 'VALID',
      extraction_confidence: 0.96,
      extracted_fields: {
        governing_law: 'Courts of Bengaluru, Karnataka',
        replacement_sla_hours: 2,
        cancellation_terms: 'Full refund if weather red alert',
      },
      source_reference: 'data/mock_docs/master_services_agreement.pdf',
    },
  ];

  const risk: RiskBreakdown = productionState?.risk_assessments || {
    vendor_risk: 1,
    contract_risk: 1,
    insurance_risk: 0,
    permit_risk: 0,
    financial_risk: 2,
    overall_level: 'MEDIUM',
    reasons: [
      'Comprehensive insurance policy verified (₹50 Lakh cover)',
      'Forest Department clearance confirmed for Agumbe eco-zone',
      'Deal value exceeds ₹10,00,000 requiring producer signoff',
    ],
  };

  const approval: ApprovalDecision = productionState?.approvals?.[0] || {
    approval_id: 'APPR-1449000',
    status: 'PENDING_PRODUCER_APPROVAL',
    requires_producer_approval: true,
    blocking_reasons: [],
    approval_reasons: [
      'All mandatory documents verified',
      'Producer approval required because deal value exceeds ₹10,00,000 threshold',
    ],
    next_action: 'Request producer approval',
    risk,
  };

  const isApproved = approval.status === 'APPROVED';
  const isBlocked = approval.status === 'BLOCKED';

  const handleApproveDeal = async () => {
    setLoading(true);
    await approveDecision(approval.approval_id);
    setLoading(false);
    router.push('/ai-planner/booking');
  };

  const handleRejectDeal = async () => {
    setLoading(true);
    await rejectDecision(approval.approval_id);
    setLoading(false);
  };

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <DemoBadge />
            <span className="mono text-[10px] text-ink-text-tertiary">· Compliance Agent Risk Governance</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <ShieldCheck className="h-6 w-6 text-greenx" />
            Compliance & Approval Center
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            Simulated document verification, 5-dimension risk scoring, and deterministic approval governance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isApproved ? (
            <button
              onClick={() => router.push('/ai-planner/booking')}
              className="flex items-center gap-2 rounded-xl bg-greenx px-6 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-greenx/90 shadow-lg shadow-greenx/20 transition-all"
            >
              <FileCheck className="h-4 w-4" />
              View Procurement Booking Record
            </button>
          ) : (
            <>
              <button
                onClick={handleRejectDeal}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl border border-redx/30 bg-redx/10 px-5 py-2.5 text-[13px] font-semibold text-redx hover:bg-redx/20 transition-all disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                Reject
              </button>
              <button
                onClick={handleApproveDeal}
                disabled={loading || isBlocked}
                className="flex items-center gap-2 rounded-xl bg-greenx px-6 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-greenx/90 shadow-lg shadow-greenx/20 transition-all disabled:opacity-50"
              >
                {loading ? (
                  <span className="h-4 w-4 rounded-full border-2 border-ink-bg border-t-transparent animate-spin-slow" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Approve & Book Shoot
              </button>
            </>
          )}
        </div>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Compliance" />

      {/* 5-Dimension Risk Matrix Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="glass rounded-xl p-4 border border-ink-border">
          <div className="mono text-[9.5px] uppercase tracking-wider text-ink-text-tertiary">Overall Risk</div>
          <div
            className={cn(
              'mono text-[20px] font-bold mt-1',
              risk.overall_level === 'LOW'
                ? 'text-greenx'
                : risk.overall_level === 'MEDIUM'
                  ? 'text-amberx'
                  : 'text-redx',
            )}
          >
            {risk.overall_level}
          </div>
          <div className="text-[10.5px] text-ink-text-tertiary mt-0.5">Policy Level</div>
        </div>

        <div className="glass rounded-xl p-4 border border-ink-border">
          <div className="mono text-[9.5px] uppercase tracking-wider text-ink-text-tertiary">Vendor Risk</div>
          <div className="mono text-[20px] font-bold text-ink-text-primary mt-1">
            {risk.vendor_risk} <span className="text-[11px] text-ink-text-tertiary">/ 5</span>
          </div>
          <div className="text-[10.5px] text-greenx mt-0.5">Verified Partner</div>
        </div>

        <div className="glass rounded-xl p-4 border border-ink-border">
          <div className="mono text-[9.5px] uppercase tracking-wider text-ink-text-tertiary">Contract Risk</div>
          <div className="mono text-[20px] font-bold text-ink-text-primary mt-1">
            {risk.contract_risk} <span className="text-[11px] text-ink-text-tertiary">/ 5</span>
          </div>
          <div className="text-[10.5px] text-ink-text-secondary mt-0.5">Standard SLA</div>
        </div>

        <div className="glass rounded-xl p-4 border border-ink-border">
          <div className="mono text-[9.5px] uppercase tracking-wider text-ink-text-tertiary">Insurance Risk</div>
          <div className="mono text-[20px] font-bold text-greenx mt-1">
            {risk.insurance_risk} <span className="text-[11px] text-ink-text-tertiary">/ 5</span>
          </div>
          <div className="text-[10.5px] text-greenx mt-0.5">₹50L Active Cover</div>
        </div>

        <div className="glass rounded-xl p-4 border border-ink-border">
          <div className="mono text-[9.5px] uppercase tracking-wider text-ink-text-tertiary">Permit Risk</div>
          <div className="mono text-[20px] font-bold text-greenx mt-1">
            {risk.permit_risk} <span className="text-[11px] text-ink-text-tertiary">/ 5</span>
          </div>
          <div className="text-[10.5px] text-greenx mt-0.5">Gazette Approved</div>
        </div>

        <div className="glass rounded-xl p-4 border border-ink-border">
          <div className="mono text-[9.5px] uppercase tracking-wider text-ink-text-tertiary">Financial Risk</div>
          <div className="mono text-[20px] font-bold text-amberx mt-1">
            {risk.financial_risk} <span className="text-[11px] text-ink-text-tertiary">/ 5</span>
          </div>
          <div className="text-[10.5px] text-amberx mt-0.5">&gt; ₹10.00L Signoff</div>
        </div>
      </div>

      {/* Main Documents Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Left 2 Cols: Document Checklist & Extraction Viewer */}
        <div className="xl:col-span-2 space-y-6">
          <div className="glass-strong rounded-2xl p-7 border border-ink-border space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-ink-text-primary flex items-center gap-2">
                <FileText className="h-5 w-5 text-amberx" />
                Verified Legal & Regulatory Documents ({docs.length})
              </h2>
              <span className="mono text-[10px] text-greenx bg-greenx/10 border border-greenx/20 px-2.5 py-1 rounded-full font-bold">
                100% Mandatory Check Passed
              </span>
            </div>

            <div className="space-y-3">
              {docs.map((doc) => {
                const isValid = doc.status === 'VALID';
                const isSelected = selectedDoc?.document_id === doc.document_id;

                return (
                  <div
                    key={doc.document_id}
                    onClick={() => setSelectedDoc(doc)}
                    className={cn(
                      'glass card-hover rounded-xl p-4.5 border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4',
                      isSelected
                        ? 'border-amberx glow-amber'
                        : isValid
                          ? 'border-greenx/30'
                          : 'border-redx/30 bg-redx/5',
                    )}
                  >
                    <div className="flex items-start gap-3.5">
                      <div
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                          isValid ? 'bg-greenx/15 text-greenx' : 'bg-redx/15 text-redx',
                        )}
                      >
                        <FileText className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="mono text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-ink-surface text-ink-text-primary border border-ink-border">
                            {doc.document_type}
                          </span>
                          <span className="mono text-[11px] text-ink-text-tertiary">
                            {doc.document_id}
                          </span>
                        </div>
                        <h3 className="text-[13.5px] font-semibold text-ink-text-primary mt-1">
                          {doc.vendor_name}
                        </h3>
                        <div className="mono text-[11px] text-ink-text-tertiary mt-0.5">
                          Validity: {doc.valid_from} to {doc.valid_until} · Confidence: {Math.round(doc.extraction_confidence * 100)}%
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0 sm:text-right">
                      {doc.coverage_amount > 0 && (
                        <div>
                          <div className="mono text-[14px] font-bold text-ink-text-primary">
                            {formatINR(doc.coverage_amount)}
                          </div>
                          <div className="text-[10px] text-ink-text-tertiary">Coverage Cap</div>
                        </div>
                      )}
                      <span
                        className={cn(
                          'mono text-[10px] font-bold uppercase px-2.5 py-1 rounded-full',
                          isValid ? 'bg-greenx/15 text-greenx' : 'bg-redx/15 text-redx',
                        )}
                      >
                        {doc.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected Document Extraction Inspector */}
          {selectedDoc && (
            <div className="glass rounded-2xl p-6 border border-amberx/30 space-y-3 animate-slide-in">
              <div className="flex items-center justify-between border-b border-ink-border/50 pb-2.5">
                <h3 className="text-[14px] font-semibold text-amberx flex items-center gap-2">
                  <FileCheck className="h-4 w-4" />
                  Extracted Document Fields · {selectedDoc.document_id}
                </h3>
                <span className="mono text-[10px] text-ink-text-tertiary">
                  Source: {selectedDoc.source_reference || 'digital verification'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                {Object.entries(selectedDoc.extracted_fields || {}).map(([k, v]) => (
                  <div key={k} className="p-2.5 rounded-lg bg-ink-surface/70 border border-ink-border">
                    <span className="mono text-[9.5px] uppercase tracking-wider text-ink-text-tertiary block mb-0.5">
                      {k.replace(/_/g, ' ')}
                    </span>
                    <span className="font-mono text-ink-text-primary font-medium">
                      {String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Col: Approval Decision Card */}
        <div className="xl:col-span-1 space-y-6">
          <div className="glass-strong rounded-2xl p-6 border border-amberx/30 glow-amber space-y-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amberx/15 text-amberx">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[15px] font-bold text-ink-text-primary">
                  {approval.status === 'APPROVED' ? 'Deal Approved & Confirmed' : 'Producer Approval Required'}
                </div>
                <div className="mono text-[11px] text-amberx mt-0.5">
                  Approval ID: {approval.approval_id}
                </div>
              </div>
            </div>

            <div className="space-y-3 text-[12px]">
              <div>
                <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary mb-1">
                  Policy Triggers
                </div>
                <ul className="space-y-1.5">
                  {approval.approval_reasons.map((reason, i) => (
                    <li key={i} className="flex items-start gap-2 text-ink-text-secondary">
                      <span className="text-amberx">•</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {approval.blocking_reasons.length > 0 && (
                <div className="p-3 rounded-xl bg-redx/10 border border-redx/25 text-redx space-y-1">
                  <div className="mono text-[10px] font-bold uppercase">Blocking Deficiencies</div>
                  {approval.blocking_reasons.map((b, i) => (
                    <div key={i} className="text-[11px]">• {b}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2">
              {!isApproved ? (
                <button
                  onClick={handleApproveDeal}
                  disabled={loading || isBlocked}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-greenx py-3 text-[13px] font-semibold text-ink-bg hover:bg-greenx/90 shadow-lg shadow-greenx/20 transition-all disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Authorize & Commit Booking
                </button>
              ) : (
                <div className="w-full text-center py-2.5 rounded-xl bg-greenx/20 text-greenx mono text-[12px] font-bold">
                  ✓ COMMITMENT CONFIRMED
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CompliancePage() {
  return (
    <AppShell>
      <CompliancePageContent />
    </AppShell>
  );
}
