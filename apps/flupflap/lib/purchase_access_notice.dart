import 'dart:async';
import 'package:flutter/material.dart';
import 'parity_strings.dart';
import 'purchase_access.dart';

class PurchaseAccessNotice extends StatefulWidget {
  const PurchaseAccessNotice({super.key, this.info});
  final PurchaseAccessInfo? info;
  @override
  State<PurchaseAccessNotice> createState() => _PurchaseAccessNoticeState();
}

class _PurchaseAccessNoticeState extends State<PurchaseAccessNotice> {
  Timer? timer;
  void startTimer() {
    timer?.cancel();
    if (widget.info?.mode == 'TEMPORARY_LIMIT') {
      timer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted) return;
        setState(() {});
        if (!widget.info!.retryAt!.isAfter(widget.info!.estimatedNow)) timer?.cancel();
      });
    }
  }
  @override
  void initState() { super.initState(); startTimer(); }
  @override
  void didUpdateWidget(covariant PurchaseAccessNotice oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.info != widget.info) startTimer();
  }
  @override
  void dispose() { timer?.cancel(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final info = widget.info;
    if (info?.mode != 'TEMPORARY_LIMIT') {
      return Padding(padding: const EdgeInsets.all(12), child: Text(context.ft(info?.mode == 'CHANGE_AMOUNT' ? 'purchaseReduceAmount' : 'purchaseReviewRequired')));
    }
    final retry = info!.retryAt!.toLocal();
    final seconds = (info.retryAt!.difference(info.estimatedNow).inMilliseconds / 1000).ceil();
    final remaining = seconds < 0 ? 0 : seconds;
    String two(int n) => n.toString().padLeft(2, '0');
    final countdown = '${two(remaining ~/ 3600)}:${two(remaining % 3600 ~/ 60)}:${two(remaining % 60)}';
    final offset = retry.timeZoneOffset;
    final zone = 'UTC${offset.isNegative ? '-' : '+'}${two(offset.inMinutes.abs() ~/ 60)}:${two(offset.inMinutes.abs() % 60)}';
    final date = MaterialLocalizations.of(context).formatFullDate(retry);
    final time = '$date · ${two(retry.hour)}:${two(retry.minute)}:${two(retry.second)} $zone';
    return Container(margin: const EdgeInsets.all(12), padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: const Color(0xFFF4F7FB), border: Border.all(color: const Color(0xFFDDE3EB)), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(context.ft('purchaseResetsAt', {'time': time}), style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF10345D))),
        const SizedBox(height: 8),
        Text(context.ft(remaining > 0 ? 'purchaseTimeRemaining' : 'purchaseWaitEnded', {'time': countdown})),
        const SizedBox(height: 8),
        Text(context.ft('purchaseEstimateConditions'), style: const TextStyle(fontSize: 12)),
      ]));
  }
}
