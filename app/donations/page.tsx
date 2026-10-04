'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  HeartHandshake,
  ArrowLeft,
  FileText,
  DollarSign,
  Package,
  Building,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import type { DonationManifest } from '@/lib/types';

export default function DonationsPage() {
  const [donations, setDonations] = useState<DonationManifest[]>([]);
  const [summary, setSummary] = useState<{ totalManifests: number; totalDeductionsUsd: number }>({
    totalManifests: 0,
    totalDeductionsUsd: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);

  const fetchDonations = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/donations');
      const data = await res.json();
      if (data.ok) {
        setDonations(data.donations);
        setSummary(data.summary);
      }
    } catch (err) {
      console.error('Failed to fetch donations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDonations();
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased">
      {/* Navigation Header */}
      <header className="border-b border-neutral-800/80 bg-neutral-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-950">
                <HeartHandshake className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-lg text-white">Food Bank Donations & Tax Deductions</h1>
                <p className="text-xs text-neutral-400">IRS Section 170(e)(3) Certified Manifests</p>
              </div>
            </div>
          </div>

          <button
            onClick={fetchDonations}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-medium text-neutral-300 hover:text-white transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Tax Summary Banner */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-950/40 via-neutral-900 to-neutral-900 border border-purple-500/20 shadow-xl">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-purple-300">
                Total Tax Deductions Claimed
              </p>
              <DollarSign className="w-5 h-5 text-purple-400" />
            </div>
            <p className="text-3xl font-extrabold text-white mt-2">
              ${summary.totalDeductionsUsd.toFixed(2)}
            </p>
            <p className="text-xs text-neutral-400 mt-1">
              IRC §170(e)(3) Cost + Half-Appreciation Capped
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-neutral-900/50 border border-neutral-800">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Donation Manifests Emitted
              </p>
              <FileText className="w-5 h-5 text-neutral-400" />
            </div>
            <p className="text-3xl font-extrabold text-white mt-2">
              {summary.totalManifests} Records
            </p>
            <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Immutable Audit Ledger Logged
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-neutral-900/50 border border-neutral-800">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Certified Partner Network
              </p>
              <Building className="w-5 h-5 text-neutral-400" />
            </div>
            <p className="text-3xl font-extrabold text-white mt-2">3 Food Banks</p>
            <p className="text-xs text-neutral-400 mt-1">
              Automated Haversine Shortest Distance Routing
            </p>
          </div>
        </div>

        {/* Manifest Table */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 backdrop-blur overflow-hidden shadow-2xl">
          <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
            <h3 className="font-semibold text-sm text-neutral-200 flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-400" />
              IRS Section 170(e)(3) Manifests
            </h3>
            <span className="text-xs text-neutral-400">
              Form 8283 Section A/B Compliant
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-950/60 text-neutral-400 uppercase text-[10px] tracking-wider border-b border-neutral-800">
                <tr>
                  <th className="py-3.5 px-6">Manifest ID / Date</th>
                  <th className="py-3.5 px-4">Product & Recipient Food Bank</th>
                  <th className="py-3.5 px-4">Units Donated</th>
                  <th className="py-3.5 px-4">Fair Market Value</th>
                  <th className="py-3.5 px-4">Cost Basis</th>
                  <th className="py-3.5 px-4">IRS Tax Deduction</th>
                  <th className="py-3.5 px-6">IRS Form Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60 font-mono">
                {donations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-neutral-500 font-sans">
                      No donation manifests generated yet. Simulate a heatwave on the dashboard to route expiring stock!
                    </td>
                  </tr>
                ) : (
                  donations.map((d) => (
                    <tr key={d.manifestId} className="hover:bg-neutral-800/20 transition-colors">
                      <td className="py-4 px-6 font-sans">
                        <div className="font-mono text-purple-300 font-medium text-xs">
                          {d.manifestId}
                        </div>
                        <div className="text-[10px] text-neutral-500 mt-0.5">
                          {new Date(d.generatedAtIso).toLocaleString()}
                        </div>
                      </td>

                      <td className="py-4 px-4 font-sans">
                        <div className="text-white font-semibold text-xs">
                          {(d as any).productName ?? 'Perishable Lot'}
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-0.5">
                          {d.recipientFoodBankName}
                        </div>
                      </td>

                      <td className="py-4 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-200 font-bold">
                          <Package className="w-3 h-3 text-neutral-400" />
                          {d.donatedQuantityUnits} units
                        </span>
                      </td>

                      <td className="py-4 px-4 font-semibold text-neutral-300">
                        ${d.totalFairMarketValue.toFixed(2)}
                      </td>

                      <td className="py-4 px-4 text-neutral-400">
                        ${d.costBasisTotal.toFixed(2)}
                      </td>

                      <td className="py-4 px-4">
                        <span className="text-emerald-400 font-bold text-sm">
                          ${d.irsDeductionAmount.toFixed(2)}
                        </span>
                      </td>

                      <td className="py-4 px-6 font-sans">
                        <span className="inline-block px-2.5 py-1 rounded text-[11px] font-semibold bg-purple-500/10 text-purple-300 border border-purple-500/20">
                          {d.irsFormReference}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
