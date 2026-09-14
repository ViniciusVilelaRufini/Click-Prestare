import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

class AppSkeleton extends StatelessWidget {
  final double width;
  final double height;
  final double borderRadius;

  const AppSkeleton({
    super.key,
    required this.width,
    required this.height,
    this.borderRadius = 8,
  });

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: AppColors.skeletonBase(context),
      highlightColor: AppColors.skeletonHighlight(context),
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: AppColors.skeletonBase(context),
          borderRadius: BorderRadius.circular(borderRadius),
        ),
      ),
    );
  }

  // Pre-defined factory for list tiles
  static Widget listTile(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppSkeleton(width: 64, height: 64, borderRadius: 12),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 8),
                AppSkeleton(width: MediaQuery.of(context).size.width * 0.5, height: 16),
                const SizedBox(height: 8),
                AppSkeleton(width: MediaQuery.of(context).size.width * 0.3, height: 12),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
