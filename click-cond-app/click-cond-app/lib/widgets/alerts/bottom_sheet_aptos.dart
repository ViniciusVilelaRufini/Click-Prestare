import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

void bottomSheetAptos(BuildContext context, List<dynamic> list, String selected, Function(String) onSelect) {
  // Sort list numerically if possible
  final sortedList = List<dynamic>.from(list);
  sortedList.sort((a, b) {
    final strA = a.toString();
    final strB = b.toString();
    final int? valA = int.tryParse(strA);
    final int? valB = int.tryParse(strB);
    if (valA != null && valB != null) {
      return valA.compareTo(valB);
    }
    return strA.compareTo(strB);
  });

  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (BuildContext bc) {
      String searchQuery = "";
      return StatefulBuilder(
        builder: (BuildContext context, StateSetter setState) {
          final filteredList = sortedList.where((item) {
            return item.toString().toLowerCase().contains(searchQuery.toLowerCase());
          }).toList();

          return Container(
            decoration: BoxDecoration(
              color: AppColors.surface(bc),
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(20),
                topRight: Radius.circular(20),
              ),
            ),
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
            constraints: BoxConstraints(
              maxHeight: MediaQuery.of(bc).size.height * 0.8,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Handle bar
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: AppSpacing.md),
                    decoration: BoxDecoration(
                      color: AppColors.border(bc),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                Text(
                  "Selecione uma opção",
                  style: AppTypography.headline(bc).copyWith(fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.md),
                
                // Search Input
                TextField(
                  decoration: InputDecoration(
                    hintText: "Buscar...",
                    hintStyle: AppTypography.bodySecondary(bc),
                    prefixIcon: const Icon(PhosphorIcons.magnifyingGlass),
                    filled: true,
                    fillColor: AppColors.surfaceElevated(bc),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none,
                    ),
                    contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: AppSpacing.md),
                  ),
                  style: AppTypography.body(bc),
                  onChanged: (value) {
                    setState(() {
                      searchQuery = value;
                    });
                  },
                ),
                const SizedBox(height: AppSpacing.md),
                
                Flexible(
                  child: filteredList.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
                          child: Text(
                            "Nenhuma opção encontrada",
                            style: AppTypography.bodySecondary(bc),
                            textAlign: TextAlign.center,
                          ),
                        )
                      : GridView.builder(
                          physics: const BouncingScrollPhysics(),
                          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 4,
                            crossAxisSpacing: 10,
                            mainAxisSpacing: 10,
                            childAspectRatio: 2.0,
                          ),
                          itemCount: filteredList.length,
                          itemBuilder: (context, index) {
                            final item = filteredList[index].toString();
                            final isSelected = selected == item;
                            return InkWell(
                              onTap: () {
                                onSelect(item);
                              },
                              borderRadius: BorderRadius.circular(10),
                              child: Container(
                                decoration: BoxDecoration(
                                  color: isSelected ? AppColors.primary : AppColors.surfaceElevated(bc),
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(
                                    color: isSelected ? AppColors.primary : AppColors.border(bc),
                                    width: 1,
                                  ),
                                ),
                                alignment: Alignment.center,
                                child: Text(
                                  item,
                                  style: AppTypography.bodyMedium(bc).copyWith(
                                    color: isSelected ? Colors.white : AppColors.textPrimary(bc),
                                    fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                ),
                const SizedBox(height: AppSpacing.lg),
              ],
            ),
          );
        },
      );
    },
  );
}
