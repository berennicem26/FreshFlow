'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Thermometer,
  Flame,
  AlertTriangle,
  HeartHandshake,
  TrendingDown,
  RefreshCw,
  Clock,
  Sparkles,
  ShoppingBag,
  Building2,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import type { MarkdownTier, PerishableBatch, PricingDecision, DonationManifest } from '@/lib/types';

interface EvaluationState {
  decision: PricingDecision;
  effectiveDte: number;
  decayFactor: number;
  donationManifest: DonationManifest | null;
}

export default function FreshFlowDashboard() {
  const [batches, setBatches] = useState<PerishableBatch[]>([]);
  const [evaluations, setEvaluations] = useState<Record<string, EvaluationState>>({});
  const [ambientTemp, setAmbientTemp] = useState<number>(20.0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Load initial inventory batches
  useEffect(() => {
    async function loadBatches() {
      try {
        const res = await fetch('/api/batches?reset=true');
        const data = await res.json();
        if (data.ok && Array.isArray(data.batches)) {
          setBatches(data.batches);
          // Auto evaluate all batches with current ambient temperature
          evaluateAll(data.batches, 20.0);
        }
      } catch (err) {
        console.error('Failed to load batches:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadBatches();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const evaluateBatch = async (batchId: string, temp: number) => {
    try {
      const res = await fetch(`/api/batches/${batchId}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulatedTemperatureCelsius: temp }),
      });
      const data = await res.json();
      if (data.ok) {
        setEvaluations((prev) => ({
          ...prev,
          [batchId]: {
            decision: data.pricingDecision,
            effectiveDte: data.effectiveDte,
            decayFactor: data.thermalDecay.computedDecayFactor,
            donationManifest: data.donationManifest,
          },
        }));
      }
    } catch (err) {
      console.error(`Evaluation error for ${batchId}:`, err);
    }
  };

  const evaluateAll = async (batchList = batches, temp = ambientTemp) => {
    setIsEvaluating(true);
    for (const b of batchList) {
      await evaluateBatch(b.batchId, temp);
    }
    setIsEvaluating(false);
    showToast(`All batches re-evaluated at ${temp}°C ambient temperature.`);
  };

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleSliderChange = (newTemp: number) => {
    setAmbientTemp(newTemp);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      evaluateAll(batches, newTemp);
    }, 250);
  };

  const dispatchDonation = async (manifestId: string, productName: string) => {
    try {
      const res = await fetch('/api/donations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifestId, notes: 'Dispatched via FreshFlow Live Hub' }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Donation for ${productName} dispatched to Food Bank!`);
      }
    } catch (err) {
      console.error('Dispatch failed:', err);
    }
  };

  const getTierBadge = (tier: MarkdownTier) => {
    switch (tier) {
      case 'NONE':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Full Price (0%)
          </span>
        );
      case 'TIER_1':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Tier 1 (-15%)
          </span>
        );
      case 'TIER_2':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
            Tier 2 (-35%)
          </span>
        );
      case 'TIER_3':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            Tier 3 (-50%)
          </span>
        );
      case 'DONATION':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <HeartHandshake className="w-3 h-3 mr-1" /> Donate (Food Bank)
          </span>
        );
      default:
        return null;
    }
  };

  // Aggregated metrics
  const activeCount = batches.length;
  const donatedCount = Object.values(evaluations).filter(
    (e) => e.decision.tier === 'DONATION'
  ).length;
  const discountedCount = Object.values(evaluations).filter((e) =>
    ['TIER_1', 'TIER_2', 'TIER_3'].includes(e.decision.tier)
  ).length;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-neutral-900 border border-emerald-500/30 text-emerald-300 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 animate-bounce">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Navigation Header */}
      <header className="border-b border-neutral-800/80 bg-neutral-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950">
              <ShoppingBag className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
                  FreshFlow
                </span>
                <span className="text-xs bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded-full border border-neutral-700">
                  v1.0 SDD
                </span>
              </div>
              <p className="text-xs text-neutral-400">Intelligent Spoilage & Dynamic Markdown Hub</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/donations"
              className="text-xs sm:text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-white transition"
            >
              <HeartHandshake className="w-4 h-4 text-purple-400" />
              <span>Donations & IRS §170(e)(3)</span>
              <ChevronRight className="w-3 h-3 text-neutral-500" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-neutral-900/50 border border-neutral-800 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-400">Monitored Batches</p>
              <p className="text-2xl font-bold text-white mt-1">{activeCount} SKUs</p>
              <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Core Invariants Verified
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-neutral-800 flex items-center justify-center text-emerald-400">
              <ShoppingBag className="w-6 h-6" />
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-neutral-900/50 border border-neutral-800 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-400">Active Markdowns</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">{discountedCount} Batches</p>
              <p className="text-xs text-neutral-400 mt-1">Tiered progressive discounts</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-neutral-800 flex items-center justify-center text-amber-400">
              <TrendingDown className="w-6 h-6" />
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-neutral-900/50 border border-neutral-800 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-400">Food Bank Routed</p>
              <p className="text-2xl font-bold text-purple-400 mt-1">{donatedCount} Batches</p>
              <p className="text-xs text-purple-300/80 mt-1">Zero landfill waste target</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-neutral-800 flex items-center justify-center text-purple-400">
              <HeartHandshake className="w-6 h-6" />
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-neutral-900/50 border border-neutral-800 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-400">Store Ambient Temp</p>
              <p className="text-2xl font-bold text-cyan-400 mt-1">{ambientTemp.toFixed(1)}°C</p>
              <p className="text-xs text-cyan-300/80 mt-1">Open-Meteo Climate Sync</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-neutral-800 flex items-center justify-center text-cyan-400">
              <Thermometer className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Ambient Temperature Simulator Banner */}
        <div className="p-6 rounded-2xl bg-gradient-to-r from-neutral-900 via-neutral-900/80 to-neutral-900 border border-neutral-800 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1 max-w-xl">
              <div className="flex items-center gap-2">
                <Flame className={`w-5 h-5 ${ambientTemp > 25 ? 'text-rose-500 animate-pulse' : 'text-amber-400'}`} />
                <h2 className="text-base font-semibold text-white">
                  Ambient Temperature & Heatwave Simulator (MCP Open-Meteo)
                </h2>
              </div>
              <p className="text-xs text-neutral-400">
                Adjust store temperature to simulate hot weather or cold-storage fluctuation.
                Notice how biological decay acceleration compresses effective shelf-life and triggers earlier discounts!
              </p>
            </div>

            <div className="flex items-center gap-4 min-w-[280px] bg-neutral-950/80 px-4 py-3 rounded-xl border border-neutral-800">
              <span className="text-xs font-medium text-neutral-400">18°C</span>
              <input
                type="range"
                min="18"
                max="35"
                step="0.5"
                value={ambientTemp}
                onChange={(e) => handleSliderChange(parseFloat(e.target.value))}
                className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <span className="text-xs font-medium text-rose-400">35°C</span>
              <span className="text-sm font-bold text-white min-w-[48px] text-right">
                {ambientTemp.toFixed(1)}°C
              </span>
            </div>

            <button
              onClick={() => evaluateAll(batches, ambientTemp)}
              disabled={isEvaluating}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition shadow-lg shadow-emerald-950 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isEvaluating ? 'animate-spin' : ''}`} />
              <span>{isEvaluating ? 'Recomputing...' : 'Evaluate All'}</span>
            </button>
          </div>
        </div>

        {/* Perishable Inventory Table */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 backdrop-blur overflow-hidden shadow-2xl">
          <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
            <h3 className="font-semibold text-sm text-neutral-200 flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-emerald-400" />
              Perishable Inventory Lots
            </h3>
            <span className="text-xs text-neutral-400">
              Functional Core evaluated in real time
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-950/60 text-neutral-400 uppercase text-[10px] tracking-wider border-b border-neutral-800">
                <tr>
                  <th className="py-3.5 px-6">Product / SKU</th>
                  <th className="py-3.5 px-4">Category</th>
                  <th className="py-3.5 px-4">Effective Shelf-Life</th>
                  <th className="py-3.5 px-4">Decay Multiplier</th>
                  <th className="py-3.5 px-4">Price / Floor</th>
                  <th className="py-3.5 px-4">Current Tier</th>
                  <th className="py-3.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60 font-mono">
                {batches.map((batch) => {
                  const evalState = evaluations[batch.batchId];
                  const dte = evalState ? evalState.effectiveDte : batch.nominalShelfLifeDays;
                  const decay = evalState ? evalState.decayFactor : 1.0;
                  const tier = evalState ? evalState.decision.tier : 'NONE';
                  const computedPrice = evalState ? evalState.decision.computedPricePerUnit : batch.msrpPerUnit;

                  return (
                    <tr
                      key={batch.batchId}
                      className="hover:bg-neutral-800/20 transition-colors"
                    >
                      <td className="py-4 px-6 font-sans">
                        <div className="font-medium text-white">{batch.productName}</div>
                        <div className="text-[11px] text-neutral-400 font-mono mt-0.5">{batch.sku}</div>
                      </td>

                      <td className="py-4 px-4 font-sans">
                        <span className="inline-block px-2 py-0.5 rounded text-[11px] bg-neutral-800 text-neutral-300 uppercase">
                          {batch.category}
                        </span>
                      </td>

                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2 font-semibold">
                          <Clock className="w-3.5 h-3.5 text-neutral-400" />
                          <span className={dte < 1.0 ? 'text-rose-400 font-bold' : dte < 2.0 ? 'text-amber-400' : 'text-emerald-400'}>
                            {dte.toFixed(1)} days left
                          </span>
                        </div>
                        <div className="w-28 bg-neutral-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              dte < 1.0 ? 'bg-rose-500' : dte < 2.0 ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(8, (dte / 5) * 100))}%` }}
                          />
                        </div>
                      </td>

                      <td className="py-4 px-4">
                        <span className={`font-semibold ${decay > 1.2 ? 'text-rose-400' : 'text-neutral-300'}`}>
                          {decay.toFixed(2)}× speed
                        </span>
                      </td>

                      <td className="py-4 px-4">
                        {computedPrice !== null ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-white">
                                ${computedPrice.toFixed(2)}
                              </span>
                              {computedPrice < batch.msrpPerUnit && (
                                <span className="line-through text-neutral-500 text-xs">
                                  ${batch.msrpPerUnit.toFixed(2)}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-neutral-500">
                              Floor: ${batch.costBasisPerUnit.toFixed(2)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-purple-400 font-semibold text-xs">
                            Donation Routing
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-4 font-sans">
                        {getTierBadge(tier)}
                      </td>

                      <td className="py-4 px-6 text-right space-x-2">
                        {tier === 'DONATION' && evalState?.donationManifest && (
                          <button
                            onClick={() =>
                              dispatchDonation(
                                evalState.donationManifest!.manifestId,
                                batch.productName
                              )
                            }
                            className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition"
                          >
                            Dispatch
                          </button>
                        )}
                        <button
                          onClick={() => evaluateBatch(batch.batchId, ambientTemp)}
                          className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-lg text-xs transition"
                        >
                          Re-eval
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
