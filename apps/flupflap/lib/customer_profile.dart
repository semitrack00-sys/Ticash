import 'package:flutter/material.dart';
import 'parity_strings.dart';

/// Only displays fields returned for the authenticated customer.
class CustomerProfileDetails extends StatelessWidget {
  const CustomerProfileDetails({super.key, required this.user});
  final Map<String, dynamic> user;

  @override
  Widget build(BuildContext context) {
    const fields = {
      'First name': 'firstName',
      'Last name': 'lastName',
      'Email address': 'email',
      'Phone number': 'phone',
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(context.ft('Profile'),
                style: Theme.of(context).textTheme.titleMedium),
            for (final field in fields.entries) ...[
              const SizedBox(height: 12),
              Text(context.ft(field.key),
                  style: Theme.of(context).textTheme.labelMedium),
              const SizedBox(height: 4),
              SelectableText(
                user[field.value] is String &&
                        (user[field.value] as String).trim().isNotEmpty
                    ? (user[field.value] as String).trim()
                    : '—',
              ),
            ],
          ],
        ),
      ),
    );
  }
}
