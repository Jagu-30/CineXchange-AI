'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMission, formatINR, formatINRLakh } from '@/lib/mission-context';
import { AppShell } from '@/components/shared/app-shell';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { DemoBadge } from '@/components/shared/demo-badge';
import {
  Brain,
  Search,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Calendar,
  MapPin,
  Sparkles,
  ArrowRight,
  ShieldAlert,
  Edit2,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function RequirementsPageContent() {
  const router = useRouter();
  const { productionState, runScout, planProject } = useMission();

  const [loading, setLoading] = useState(false);
  const [approvedLocally, setApprovedLocally] = useState(false);

  const requirements = productionState?.requirements || [];
  const project = productionState?.project || {
    project_id: 'PROJ-001',
    title: 'Rainforest Night Shoot',
    budget: 2500000,
    duration_days: 3,
    location: 'Western Ghats rainforest',
    producer_request: 'We need to shoot two low-light rainforest scenes over three days within ₹25 lakh.',
  };

  const handleApprove = () => {
    setApprovedLocally(true);
  };

  const handleRunScout = async () => {
    setLoading(true);
    await runScout();
    setLoading(false);
    router.push('/ai-planner/marketplace');
  };

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1500px] mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <DemoBadge />
            <span className="mono text-[10px] text-ink-text-tertiary">· Producer Agent Output</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-text-primary flex items-center gap-2.5">
            <Brain className="h-6 w-6 text-amberx" />
            Requirement Review & Structured Plan
          </h1>
          <p className="text-[13px] text-ink-text-secondary mt-1 max-w-2xl">
            Producer Agent analyzed the natural-language brief and extracted structured production requirements with technical specifications.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleApprove}
            className={cn(
              'flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all',
              approvedLocally
                ? 'bg-greenx/20 text-greenx border border-greenx/30 cursor-default'
                : 'bg-ink-surface text-ink-text-primary border border-ink-border hover:border-amberx/40',
            )}
          >
            {approvedLocally ? <Check className="h-4 w-4 text-greenx" /> : <FileCheck className="h-4 w-4 text-amberx" />}
            {approvedLocally ? 'Requirements Approved' : 'Approve Requirements'}
          </button>

          <button
            onClick={handleRunScout}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-amberx px-5 py-2.5 text-[13px] font-semibold text-ink-bg hover:bg-amberx/90 shadow-lg shadow-amberx/20 transition-all disabled:opacity-50"
          >
            {loading ? (
              <span className="h-4 w-4 rounded-full border-2 border-ink-bg border-t-transparent animate-spin-slow" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Run Marketplace Scout
          </button>
        </div>
      </header>

      {/* Stepper */}
      <WorkflowStepper currentStep="Specs" />

      {/* Project Meta Banner */}
      <div className="glass rounded-2xl p-6 border border-ink-border grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Project Title</div>
          <div className="text-[14px] font-semibold text-ink-text-primary mt-1">{project.title}</div>
        </div>
        <div>
          <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Budget Ceiling</div>
          <div className="mono text-[14px] font-semibold text-amberx mt-1">{formatINR(project.budget)}</div>
        </div>
        <div>
          <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Duration</div>
          <div className="mono text-[14px] font-semibold text-bluex mt-1">{project.duration_days} Shoot Days</div>
        </div>
        <div>
          <div className="mono text-[10px] uppercase tracking-wider text-ink-text-tertiary">Location</div>
          <div className="text-[14px] font-semibold text-greenx mt-1">{project.location}</div>
        </div>
      </div>

      {/* Requirements Table */}
      <div className="glass-strong rounded-2xl p-7 border border-ink-border space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amberx/15 text-amberx">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-ink-text-primary">
                Extracted Production Requirements ({requirements.length || 9})
              </h2>
              <p className="text-[11.5px] text-ink-text-secondary">
                Validated requirements enforcing mandatory low-light camera ISO sensitivity, silent generators, and insurance.
              </p>
            </div>
          </div>
          <span className="mono text-[10px] text-greenx font-semibold uppercase px-2.5 py-1 rounded-full bg-greenx/10 border border-greenx/20">
            Validated by Python Policy
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ink-border text-[10px] uppercase font-mono tracking-wider text-ink-text-tertiary">
                <th className="pb-3 pr-4">ID</th>
                <th className="pb-3 pr-4">Category</th>
                <th className="pb-3 pr-4">Resource</th>
                <th className="pb-3 pr-4">Type</th>
                <th className="pb-3 pr-4 text-center">Qty</th>
                <th className="pb-3 pr-4 text-center">Days</th>
                <th className="pb-3 pr-4">Key Specifications</th>
                <th className="pb-3 pr-4">Priority</th>
                <th className="pb-3">Mandatory</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-border/40 text-[12.5px]">
              {(requirements.length > 0
                ? requirements
                : [
                    {
                      requirement_id: 'REQ-CAM-001',
                      category: 'EQUIPMENT',
                      resource: 'Primary Large-Format Cinema Camera Package (ARRI Alexa Mini LF / Sony FX9)',
                      resource_type: 'CAMERA',
                      quantity: 1,
                      duration_days: 3,
                      specifications: { low_light: true, dual_base_iso: true, weather_sealed: true, scenes: 2 },
                      priority: 'CRITICAL',
                      mandatory: true,
                    },
                    {
                      requirement_id: 'REQ-CAM-002',
                      category: 'EQUIPMENT',
                      resource: 'B-Camera Body + 3-Axis Gimbal Rig',
                      resource_type: 'CAMERA',
                      quantity: 1,
                      duration_days: 3,
                      specifications: { low_light: true, gimbal_compatible: true },
                      priority: 'HIGH',
                      mandatory: true,
                    },
                    {
                      requirement_id: 'REQ-LGT-001',
                      category: 'EQUIPMENT',
                      resource: 'Weatherproof Astera Titan LED Tube Kit (x12) + Haze',
                      resource_type: 'LIGHTING',
                      quantity: 1,
                      duration_days: 3,
                      specifications: { waterproof_rating: 'IP65', battery_powered: true },
                      priority: 'HIGH',
                      mandatory: true,
                    },
                    {
                      requirement_id: 'REQ-GEN-001',
                      category: 'EQUIPMENT',
                      resource: 'Silent 15kVA Diesel Inverter Generator + Fuel Kit',
                      resource_type: 'GENERATOR',
                      quantity: 1,
                      duration_days: 3,
                      specifications: { sound_db_max: 55, fuel_reserve_days: 3 },
                      priority: 'HIGH',
                      mandatory: true,
                    },
                    {
                      requirement_id: 'REQ-DRN-001',
                      category: 'EQUIPMENT',
                      resource: 'DJI Inspire 3 Aerial Cinema Rig + Zenmuse X9-8K',
                      resource_type: 'DRONE',
                      quantity: 1,
                      duration_days: 3,
                      specifications: { full_frame_8k: true, night_rpas_certified: true },
                      priority: 'MEDIUM',
                      mandatory: false,
                    },
                    {
                      requirement_id: 'REQ-PLT-001',
                      category: 'CREW',
                      resource: 'DGCA Category-1 Night-Endorsed Drone Pilot',
                      resource_type: 'PILOT',
                      quantity: 1,
                      duration_days: 3,
                      specifications: { dgca_license_valid: true, night_rating: true },
                      priority: 'MEDIUM',
                      mandatory: false,
                    },
                    {
                      requirement_id: 'REQ-TRN-001',
                      category: 'LOGISTICS',
                      resource: '4WD All-Terrain Crew Van & Covered Equipment Truck',
                      resource_type: 'TRANSPORT',
                      quantity: 1,
                      duration_days: 3,
                      specifications: { four_wheel_drive: true, crew_seats: 14 },
                      priority: 'HIGH',
                      mandatory: true,
                    },
                    {
                      requirement_id: 'REQ-INS-001',
                      category: 'COMPLIANCE',
                      resource: 'On-Location Shoot Equipment & Crew All-Risk Insurance',
                      resource_type: 'INSURANCE',
                      quantity: 1,
                      duration_days: 3,
                      specifications: { min_coverage_inr: 2500000, weather_delay_rider: true },
                      priority: 'CRITICAL',
                      mandatory: true,
                    },
                    {
                      requirement_id: 'REQ-PRM-001',
                      category: 'COMPLIANCE',
                      resource: 'Karnataka Forest Dept. Night Filming Clearance',
                      resource_type: 'PERMIT',
                      quantity: 1,
                      duration_days: 3,
                      specifications: { night_hours_approved: true, eco_zone: 'Agumbe' },
                      priority: 'CRITICAL',
                      mandatory: true,
                    },
                  ]
              ).map((req) => (
                <tr key={req.requirement_id} className="hover:bg-ink-raised/40 transition-colors">
                  <td className="py-3.5 pr-4 mono text-[11px] text-ink-text-tertiary">{req.requirement_id}</td>
                  <td className="py-3.5 pr-4">
                    <span className="mono text-[10.5px] uppercase px-2 py-0.5 rounded-full bg-ink-surface text-ink-text-secondary border border-ink-border">
                      {req.category}
                    </span>
                  </td>
                  <td className="py-3.5 pr-4 font-medium text-ink-text-primary max-w-xs">{req.resource}</td>
                  <td className="py-3.5 pr-4 mono text-[11px] text-amberx">{req.resource_type}</td>
                  <td className="py-3.5 pr-4 text-center mono font-bold">{req.quantity}</td>
                  <td className="py-3.5 pr-4 text-center mono text-ink-text-secondary">{req.duration_days}d</td>
                  <td className="py-3.5 pr-4 max-w-sm">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(req.specifications || {}).map(([k, v]) => (
                        <span
                          key={k}
                          className="mono text-[9.5px] px-1.5 py-0.5 rounded bg-ink-surface text-ink-text-secondary border border-ink-border/70"
                        >
                          {k}: {String(v)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3.5 pr-4">
                    <span
                      className={cn(
                        'mono text-[10px] font-bold px-2 py-0.5 rounded',
                        req.priority === 'CRITICAL' ? 'bg-redx/15 text-redx' : req.priority === 'HIGH' ? 'bg-amberx/15 text-amberx' : 'bg-bluex/15 text-bluex',
                      )}
                    >
                      {req.priority}
                    </span>
                  </td>
                  <td className="py-3.5">
                    {req.mandatory ? (
                      <span className="mono text-[10px] text-greenx font-semibold">MANDATORY</span>
                    ) : (
                      <span className="mono text-[10px] text-ink-text-tertiary">OPTIONAL</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assumptions & Missing Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Assumptions */}
        <div className="glass rounded-2xl p-6 border border-ink-border space-y-3">
          <div className="flex items-center gap-2 text-ink-text-primary font-semibold text-[14px]">
            <Sparkles className="h-4 w-4 text-amberx" />
            Extracted Assumptions
          </div>
          <ul className="space-y-2 text-[12px] text-ink-text-secondary">
            <li className="flex items-start gap-2">
              <span className="text-amberx">•</span>
              Shoot takes place across 3 consecutive night shifts in Agumbe rainforest buffer zone.
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amberx">•</span>
              Grid power is completely absent on-location, requiring 15kVA silent generator power.
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amberx">•</span>
              Standard 14-person production crew traveling from Bengaluru hub.
            </li>
          </ul>
        </div>

        {/* Missing Info / Warnings */}
        <div className="glass rounded-2xl p-6 border border-amberx/30 bg-amberx/5 space-y-3">
          <div className="flex items-center gap-2 text-amberx font-semibold text-[14px]">
            <ShieldAlert className="h-4 w-4" />
            Attention & Logistics Notice
          </div>
          <ul className="space-y-2 text-[12px] text-ink-text-secondary">
            <li className="flex items-start gap-2">
              <span className="text-amberx">⚠</span>
              Forest Department filming clearance strictly forbids noisy generators (&gt;60dB) in eco-sensitive zones.
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amberx">⚠</span>
              Drone pilot must possess DGCA Category-1 night flying authorization for forest airspace.
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amberx">⚠</span>
              Equipment insurance policy must explicitly include weather-delay payout terms.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function RequirementsPage() {
  return (
    <AppShell>
      <RequirementsPageContent />
    </AppShell>
  );
}
